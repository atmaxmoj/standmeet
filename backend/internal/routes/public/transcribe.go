// transcribe.go —— POST /api/v1/transcribe: a visitor's recording becomes text for the input box
// (docs/design/voice-input.md). The face knows nothing of engines or models: the composition root
// hands it Transcribe (the instance's own speech service behind the OpenAI transcription shape).
// It checks the session (the decorator), caps the upload before reading it all, and turns every
// failure into a sentence the composer can show.

package public

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// maxRecordingBytes —— a minute of opus is ~0.5 MB; 2 MiB leaves room for a browser that records
// AAC, and refuses anything that is not a short spoken question.
const maxRecordingBytes = 2 << 20

// maxRequestBytes —— the hard stop on the whole body. Larger than the recording cap on purpose: a
// body cut off mid-upload resets the connection, and the app's proxy turns that reset into a bare
// 500 (2026-10-01). Read to here, a too-long recording gets its 413 and its sentence.
const maxRequestBytes = 16 << 20

// Transcriber —— the composition root's answer to "what was said in this recording". Its errors
// are display errors already (busy / unreadable / too long) or plain errors (a 5xx).
type Transcriber func(
	ctx context.Context, filename, contentType string, audio []byte,
) (string, error)

type transcribeResponse struct {
	Text string `json:"text"`
}

type voiceStatusResponse struct {
	Available bool `json:"available"`
}

// recording —— one upload, read and capped.
type recording struct {
	filename, contentType string
	audio                 []byte
}

func (h *Handlers) transcribe() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rec, rerr := readRecording(w, r)
		if rerr != nil {
			writeError(h.Log, w, apierr.Classify(rerr, nil))
			return
		}
		text, err := h.Transcribe(r.Context(), rec.filename, rec.contentType, rec.audio)
		if err != nil {
			h.writeTranscribeErr(w, err, len(rec.audio))
			return
		}
		h.writeVoiceJSON(w, transcribeResponse{Text: text})
	}
}

// voiceStatus —— GET /api/v1/voice: the composer offers the mic only when the speech service is up.
func (h *Handlers) voiceStatus() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		on := h.VoiceAvailable != nil && h.VoiceAvailable(r.Context())
		h.writeVoiceJSON(w, voiceStatusResponse{Available: on})
	}
}

func (h *Handlers) writeTranscribeErr(w http.ResponseWriter, err error, n int) {
	env := apierr.Classify(err, nil)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error("transcribe", "err", err, "bytes", n)
	}
	writeError(h.Log, w, env)
}

// writeVoiceJSON —— the two voice bodies (a named union, since the package bans `any` bodies).
func (h *Handlers) writeVoiceJSON(w http.ResponseWriter, body interface{ voiceBody() }) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		h.Log.Error("encode voice response", "err", err)
	}
}

func (transcribeResponse) voiceBody()  {}
func (voiceStatusResponse) voiceBody() {}

// readRecording —— the "audio" part, capped; a refusal is a display error.
func readRecording(w http.ResponseWriter, r *http.Request) (recording, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	file, head, err := r.FormFile("audio")
	if err != nil {
		return recording{}, recordingReadErr(err)
	}
	audio, rerr := io.ReadAll(io.LimitReader(file, maxRecordingBytes+1))
	if cerr := errors.Join(rerr, file.Close(), oversize(len(audio))); cerr != nil {
		return recording{}, tooLong(cerr)
	}
	ct := head.Header.Get("Content-Type")
	return recording{filename: head.Filename, contentType: ct, audio: audio}, nil
}

func recordingReadErr(err error) error {
	if big, ok := errors.AsType[*http.MaxBytesError](err); ok && big != nil {
		return tooLong(err)
	}
	return apierr.DisplayWrap(http.StatusBadRequest, "bad_recording",
		"the recording didn't arrive — try again", err)
}

var errOversize = errors.New("recording over the cap")

func oversize(n int) error {
	if n > maxRecordingBytes {
		return errOversize
	}
	return nil
}

func tooLong(cause error) error {
	return apierr.DisplayWrap(http.StatusRequestEntityTooLarge, "recording_too_long",
		"that recording is too long — keep it under a minute", cause)
}
