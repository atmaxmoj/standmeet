// Package stt —— the instance's speech-to-text, in the backend process
// (docs/design/voice-input.md): SenseVoice-Small (int8) on sherpa-onnx, CPU only, the model baked
// into the backend image. The business side calls Transcribe and knows nothing of models or audio
// formats; swapping the engine changes this package only.
//
// Audio arrives as 16 kHz mono 16-bit WAV: the browser decodes and resamples its own recording, so
// the backend needs no ffmpeg. Nothing is stored — the samples live for one call.
package stt

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	sherpa "github.com/k2-fsa/sherpa-onnx-go/sherpa_onnx"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

const (
	// maxSeconds —— a spoken question, not a dictation.
	maxSeconds = 90
	// featureDim —— SenseVoice's fbank feature size (sherpa-onnx's documented setting).
	featureDim = 80
)

// marker —— SenseVoice writes inline tags (<|en|><|NEUTRAL|><|Speech|><|withitn|>); keep the words.
var marker = regexp.MustCompile(`<\|[^|]*\|>`)

// Engine —— one recognizer, built on first use and reused; sherpa-onnx recognizers are not
// thread-safe, so decoding is serialised (a chat clip decodes in well under a second).
type Engine struct {
	rec *sherpa.OfflineRecognizer
	dir string
	mu  sync.Mutex
}

// New —— modelDir holds model.int8.onnx and tokens.txt. A missing model → never available.
func New(modelDir string) *Engine {
	return &Engine{dir: modelDir}
}

// Available —— whether this backend carries the model (the composer offers the mic only then).
func (e *Engine) Available(_ context.Context) bool {
	return fileExists(e.modelFile()) && fileExists(e.tokensFile())
}

// Transcribe —— one recording's words. Refusals (not a WAV, too long) are display errors with a
// sentence; a missing model is a busy display error.
func (e *Engine) Transcribe(
	ctx context.Context, _, _ string, audio []byte,
) (string, error) {
	if !e.Available(ctx) {
		return "", apierr.DisplayWrap(http.StatusServiceUnavailable, "voice_busy",
			"voice input isn't available here — type your question instead", errNoModel)
	}
	samples, err := decodeWAV(audio)
	if err != nil {
		return "", apierr.DisplayWrap(http.StatusBadRequest, "bad_recording",
			"the recording couldn't be read — try again", err)
	}
	if len(samples) > maxSeconds*sampleRate {
		return "", apierr.DisplayWrap(http.StatusRequestEntityTooLarge, "recording_too_long",
			"that recording is too long — keep it under a minute", errTooLong)
	}
	if len(samples) == 0 {
		return "", nil
	}
	return e.decode(samples), nil
}

func (e *Engine) modelFile() string  { return filepath.Join(e.dir, "model.int8.onnx") }
func (e *Engine) tokensFile() string { return filepath.Join(e.dir, "tokens.txt") }

func (e *Engine) decode(samples []float32) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.rec == nil {
		e.rec = sherpa.NewOfflineRecognizer(e.config())
	}
	stream := sherpa.NewOfflineStream(e.rec)
	defer sherpa.DeleteOfflineStream(stream)
	stream.AcceptWaveform(sampleRate, samples)
	e.rec.Decode(stream)
	return strings.TrimSpace(marker.ReplaceAllString(stream.GetResult().Text, ""))
}

func (e *Engine) config() *sherpa.OfflineRecognizerConfig {
	c := sherpa.OfflineRecognizerConfig{}
	c.FeatConfig = sherpa.FeatureConfig{SampleRate: sampleRate, FeatureDim: featureDim}
	c.ModelConfig.SenseVoice = sherpa.OfflineSenseVoiceModelConfig{
		Model: e.modelFile(), Language: "auto", UseInverseTextNormalization: 1,
	}
	c.ModelConfig.Tokens = e.tokensFile()
	c.ModelConfig.NumThreads = 2
	c.ModelConfig.Provider = "cpu"
	c.DecodingMethod = "greedy_search"
	return &c
}

var (
	errNoModel = errors.New("speech model not present")
	errTooLong = errors.New("recording over the length cap")
)

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}
