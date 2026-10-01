// Package stt —— the instance's speech-to-text, reached over the OpenAI transcription shape
// (docs/design/voice-input.md). The bundled `stt` service speaks it; so does any other compatible
// engine, so swapping the engine is a URL, not code. The client knows the wire and nothing else: no
// sessions, no caps, no models.
package stt

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	transcribeTimeout = 60 * time.Second
	healthTTL         = time.Minute
)

// Client —— one speech service. Build it with New.
type Client struct {
	checkedAt time.Time
	http      *http.Client
	health    *http.Client
	endpoint  string
	mu        sync.Mutex
	up        bool
}

// New —— endpoint is the service's base URL (e.g. http://stt:8080). Empty → a client that is never
// available, so the composer offers no mic.
func New(endpoint string) *Client {
	return &Client{
		http:     httpx.NewClient(httpx.Options{Timeout: transcribeTimeout}),
		health:   httpx.NewClient(httpx.Options{Timeout: 3 * time.Second}),
		endpoint: strings.TrimRight(endpoint, "/"),
	}
}

// Available —— whether the service answers its health check; probed at most once a minute.
func (c *Client) Available(ctx context.Context) bool {
	if c.endpoint == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.checkedAt) < healthTTL {
		return c.up
	}
	c.up = c.probe(ctx)
	c.checkedAt = time.Now()
	return c.up
}

// Transcribe —— send one recording, get its text. The service's refusals (too long, unreadable)
// come back as display errors with a sentence; an unreachable service is a busy display error.
func (c *Client) Transcribe(
	ctx context.Context, filename, contentType string, audio []byte,
) (string, error) {
	form, err := newForm(filename, contentType, audio)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.endpoint+"/v1/audio/transcriptions", &form.body)
	if err != nil {
		return "", fmt.Errorf("transcribe request: %w", err)
	}
	req.Header.Set("Content-Type", form.contentType)
	resp, err := c.http.Do(req)
	if err != nil {
		c.markDown()
		return "", apierr.DisplayWrap(http.StatusServiceUnavailable, "voice_busy",
			"voice input isn't answering right now — type your question instead", err)
	}
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if cerr := errors.Join(readErr, resp.Body.Close()); cerr != nil {
		return "", fmt.Errorf("read transcription: %w", cerr)
	}
	return transcriptionOf(resp.StatusCode, raw)
}

func (c *Client) probe(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.endpoint+"/healthz", http.NoBody)
	if err != nil {
		return false
	}
	resp, err := c.health.Do(req)
	if err != nil {
		return false
	}
	return resp.Body.Close() == nil && resp.StatusCode == http.StatusOK
}

func (c *Client) markDown() {
	c.mu.Lock()
	c.up, c.checkedAt = false, time.Now()
	c.mu.Unlock()
}

type transcription struct {
	Text string `json:"text"`
}

// refusals —— what the service's own refusals say to a visitor.
var refusals = map[int]struct{ code, message string }{
	http.StatusRequestEntityTooLarge: {
		"recording_too_long", "that recording is too long — keep it under a minute",
	},
	http.StatusBadRequest: {"bad_recording", "the recording couldn't be read — try again"},
}

func transcriptionOf(status int, raw []byte) (string, error) {
	if r, ok := refusals[status]; ok {
		return "", apierr.DisplayWrap(status, r.code, r.message, errors.New(string(raw)))
	}
	if status != http.StatusOK {
		return "", fmt.Errorf("speech service answered %d: %s", status, raw)
	}
	var t transcription
	if err := json.Unmarshal(raw, &t); err != nil {
		return "", fmt.Errorf("decode transcription: %w", err)
	}
	return strings.TrimSpace(t.Text), nil
}

// form —— the multipart body and its boundary-carrying content type.
type form struct {
	contentType string
	body        bytes.Buffer
}

func newForm(filename, contentType string, audio []byte) (*form, error) {
	f := &form{}
	w := multipart.NewWriter(&f.body)
	part, err := w.CreatePart(fileHeader(filename, contentType))
	if err == nil {
		_, err = part.Write(audio)
	}
	if err == nil {
		err = w.WriteField("model", "sensevoice")
	}
	if err == nil {
		err = w.Close()
	}
	if err != nil {
		return nil, fmt.Errorf("transcribe form: %w", err)
	}
	f.contentType = w.FormDataContentType()
	return f, nil
}

func fileHeader(filename, contentType string) textproto.MIMEHeader {
	if filename == "" {
		filename = "speech.webm"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	h.Set("Content-Type", contentType)
	return h
}
