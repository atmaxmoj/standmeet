package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func testLogger() *slog.Logger { return slog.New(slog.DiscardHandler) }

// fake readers for the cache. The counter proves the bytes are cached (storage hit only on change).
type favStub struct {
	idErr     error
	metaErr   error
	fetchErr  error
	id        string
	ct        string
	buf       []byte
	fetchHits int
}

func (s *favStub) cache() *faviconCache {
	return &faviconCache{
		log:         testLogger(),
		soleFavicon: func(context.Context) (string, error) { return s.id, s.idErr },
		assetMeta: func(_ context.Context, id string) (string, string, error) {
			return "key-" + id, s.ct, s.metaErr
		},
		fetchBytes: func(context.Context, string) ([]byte, error) {
			s.fetchHits++
			return s.buf, s.fetchErr
		},
	}
}

func get(c *faviconCache) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/f.ico", http.NoBody)
	c.serve()(w, r)
	return w
}

func body(t *testing.T, w *httptest.ResponseRecorder) []byte {
	t.Helper()
	b, err := io.ReadAll(w.Result().Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

// A picked custom favicon is served with its own content-type + bytes.
func TestFaviconServesCustom(t *testing.T) {
	s := &favStub{id: "a1", ct: "image/png", buf: []byte("PNG-a1")}
	w := get(s.cache())
	if ct := w.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content-type = %q, want image/png", ct)
	}
	if got := string(body(t, w)); got != "PNG-a1" {
		t.Fatalf("body = %q, want PNG-a1", got)
	}
}

// No custom favicon (empty id) → the embedded default, never a 404.
func TestFaviconNoCustomServesDefault(t *testing.T) {
	s := &favStub{id: ""}
	w := get(s.cache())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (default served)", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != defaultFaviconCT {
		t.Fatalf("content-type = %q, want %q", ct, defaultFaviconCT)
	}
	if !bytes.Equal(body(t, w), defaultFavicon) {
		t.Fatal("no-custom body should be the embedded default")
	}
}

// Deselect: an owner who clears their favicon (id back to "") falls back to the default.
func TestFaviconDeselectFallsBackToDefault(t *testing.T) {
	s := &favStub{id: "a1", ct: "image/png", buf: []byte("PNG-a1")}
	c := s.cache()
	_ = get(c) // custom is live + cached
	s.id = ""  // owner deselects
	w := get(c)
	if ct := w.Header().Get("Content-Type"); ct != defaultFaviconCT {
		t.Fatalf("after deselect content-type = %q, want %q", ct, defaultFaviconCT)
	}
	if !bytes.Equal(body(t, w), defaultFavicon) {
		t.Fatal("after deselect body should be the default")
	}
}

// The bytes are cached: same id twice hits storage once; a changed id reloads.
func TestFaviconReloadsOnlyOnChange(t *testing.T) {
	s := &favStub{id: "a1", ct: "image/png", buf: []byte("PNG-a1")}
	c := s.cache()
	_ = get(c)
	_ = get(c)
	if s.fetchHits != 1 {
		t.Fatalf("fetchHits = %d, want 1 (bytes cached across requests)", s.fetchHits)
	}
	s.id, s.buf = "b2", []byte("PNG-b2")
	if got := string(body(t, get(c))); got != "PNG-b2" {
		t.Fatalf("after id change body = %q, want PNG-b2", got)
	}
	if s.fetchHits != 2 {
		t.Fatalf("fetchHits = %d, want 2 (one reload on change)", s.fetchHits)
	}
}

// A load failure (missing asset / storage error) falls back to the default, not a 500.
func TestFaviconLoadFailureFallsBackToDefault(t *testing.T) {
	s := &favStub{id: "gone", metaErr: errors.New("no such asset")}
	w := get(s.cache())
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (default on load failure)", w.Code)
	}
	if !bytes.Equal(body(t, w), defaultFavicon) {
		t.Fatal("load failure should serve the default")
	}
}
