// live_socket.go —— the owner's live stream relay loop (live.go). The select over frames, the
// ping and the request's end is the protocol itself, like the other socket loops.
//
// The stream lives as long as the owner's page. Each write moves the write deadline on, so the
// server's 30s write timeout does not cut it; a comment-line ping keeps it from going idle, which
// a proxy ends (Cloudflare after 100s), and keeps the deadline moving between turns.

package public

import (
	"log/slog"
	"net/http"
	"strings"
	"time"
)

const (
	// livePing —— after this long with no frame, the stream says it is still there.
	livePing = 15 * time.Second
	// liveWriteBudget —— each write's deadline; over livePing, so a ping always lands in time.
	liveWriteBudget = 30 * time.Second
)

// relayLive —— copies the feed to the owner's SSE stream until either ends.
func relayLive(w http.ResponseWriter, r *http.Request, frames <-chan []byte, log *slog.Logger) {
	w.Header().Set("Content-Type", "text/event-stream")
	// no-transform: the app's response compression would hold small frames in its gzip buffer
	// (measured 2026-10-01: zero bytes in 6 s through the app with Accept-Encoding: gzip).
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	write := func(b []byte) bool {
		if err := rc.SetWriteDeadline(time.Now().Add(liveWriteBudget)); err != nil {
			log.Warn("live stream: write deadline not extendable (server WriteTimeout caps it)",
				"err", err)
		}
		return writeAndFlush(w, b)
	}
	write(streamOpening(": live\n"))
	for liveStep(write, frames, r.Context().Done()) {
	}
}

// liveStep —— one frame, or a ping after livePing of quiet; false once the feed or the request
// is over.
func liveStep(write func([]byte) bool, frames <-chan []byte, done <-chan struct{}) bool {
	select {
	case frame, open := <-frames:
		return open && write(frame)
	case <-time.After(livePing):
		return write([]byte(": ping\n\n"))
	case <-done:
		return false
	}
}

// openingPad —— an SSE comment line of padding, past a compressing proxy's decision size. Coolify
// puts Traefik's compress middleware on every service; Traefik holds a response until it has about
// 1KB (Caddy's encode: 512B) to decide whether to compress, so a stream of small frames reached the
// browser only when it ended (sijie.xyz, measured 2026-10-02: first byte at 20.3s with
// Accept-Encoding, 0.4s without). Clients ignore comment lines.
var openingPad = ": " + strings.Repeat(".", 2048) + "\n"

// streamOpening —— a stream's first frame: its own lines, then the padding, then the frame's end.
func streamOpening(lines string) []byte {
	return []byte(lines + openingPad + "\n")
}

func writeAndFlush(w http.ResponseWriter, b []byte) bool {
	if _, err := w.Write(b); err != nil {
		return false
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	return true
}
