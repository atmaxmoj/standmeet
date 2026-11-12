// Package sse —— Server-Sent Events plumbing shared by the owner's live feeds (the conversation
// relay, the microsite store socket, the screen-assistant cue stream). It holds the one thing these
// streams must get right together: the headers and the opening pad that stop Coolify's compressing
// proxy from buffering a stream of small frames until it ends.
package sse

import (
	"net/http"
	"strings"
	"time"
)

const (
	// Ping —— after this long with no frame, a stream sends a comment line so a proxy does not end
	// it as idle (Cloudflare cuts an idle stream at 100s).
	Ping = 15 * time.Second
	// WriteBudget —— each write's deadline; over Ping so a ping always lands before a server
	// WriteTimeout would cut the stream.
	WriteBudget = 30 * time.Second
)

// Headers —— the SSE content type and the two cache directives that keep small frames flowing:
// no-transform leaves them uncompressed (the app's own gzip otherwise holds them in its buffer),
// X-Accel-Buffering turns off proxy-side buffering.
func Headers(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
}

// openingPad —— a comment line past a compressing proxy's decision size. Coolify puts Traefik's
// compress middleware on every service; Traefik holds a response until it has ~1KB to decide
// whether to compress, so a stream of small frames reached the browser only when it ended
// (sijie.xyz, measured 2026-10-02: first byte at 20.3s with Accept-Encoding, 0.4s without).
// Clients ignore comment lines.
var openingPad = ": " + strings.Repeat(".", 2048) + "\n"

// Opening —— a stream's first frame: its own lines, then the pad, then a blank line.
func Opening(lines string) []byte { return []byte(lines + openingPad + "\n") }

// WriteAndFlush —— write b and flush it to the client; false once the client is gone.
func WriteAndFlush(w http.ResponseWriter, b []byte) bool {
	if _, err := w.Write(b); err != nil {
		return false
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	return true
}
