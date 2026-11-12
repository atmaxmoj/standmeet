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
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/sse"
)

// relayLive —— copies the feed to the owner's SSE stream until either ends.
func relayLive(w http.ResponseWriter, r *http.Request, frames <-chan []byte, log *slog.Logger) {
	sse.Headers(w)
	rc := http.NewResponseController(w)
	write := func(b []byte) bool {
		if err := rc.SetWriteDeadline(time.Now().Add(sse.WriteBudget)); err != nil {
			log.Warn("live stream: write deadline not extendable (server WriteTimeout caps it)",
				"err", err)
		}
		return sse.WriteAndFlush(w, b)
	}
	write(sse.Opening(": live\n"))
	for liveStep(write, frames, r.Context().Done()) {
	}
}

// liveStep —— one frame, or a ping after sse.Ping of quiet; false once the feed or the request
// is over.
func liveStep(write func([]byte) bool, frames <-chan []byte, done <-chan struct{}) bool {
	select {
	case frame, open := <-frames:
		return open && write(frame)
	case <-time.After(sse.Ping):
		return write([]byte(": ping\n\n"))
	case <-done:
		return false
	}
}
