//go:build sttlive

// engine_live_test.go —— the real model on the e2e recordings. Not part of `go test ./...` (the model
// is baked into the image, not checked in); run it with the model on disk:
//
//	STT_MODEL_DIR=/path/to/sense-voice go test -tags sttlive ./internal/infra/stt/
//
// The product path is covered end to end by e2e/test/voice-input.spec.ts.

package stt_test

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/stt"
)

func TestEngineTranscribesTheRecordings(t *testing.T) {
	dir := os.Getenv("STT_MODEL_DIR")
	require.NotEmpty(t, dir, "STT_MODEL_DIR must point at the SenseVoice model")
	e := stt.New(dir)
	require.True(t, e.Available(context.Background()), "the model is on disk")
	for wav, want := range map[string]string{
		"voice-en.wav": "brown fox",
		"voice-zh.wav": "天气",
	} {
		audio, err := os.ReadFile("../../../../e2e/fixtures/audio/" + wav)
		require.NoError(t, err)
		text, err := e.Transcribe(context.Background(), wav, "audio/wav", audio)
		require.NoError(t, err)
		require.Contains(t, text, want, wav)
	}
}
