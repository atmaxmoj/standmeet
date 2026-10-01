// live_socket.go —— the owner's live stream relay loop (live.go). The select over frames and the
// request's end is the protocol itself, like the other socket loops.
//
// ponytail: no heartbeat; a proxy that closes idle streams ends the owner's view between turns
// (the page then shows what it has). Add a comment-line heartbeat if a deployment needs it.

package public

import "net/http"

// relayLive —— copies the feed to the owner's SSE stream until either ends.
func relayLive(w http.ResponseWriter, r *http.Request, frames <-chan []byte) {
	w.Header().Set("Content-Type", "text/event-stream")
	// no-transform: the app's response compression would hold small frames in its gzip buffer
	// (measured 2026-10-01: zero bytes in 6 s through the app with Accept-Encoding: gzip).
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	writeAndFlush(w, []byte(": live\n\n"))
	for liveStep(w, frames, r.Context().Done()) {
	}
}

// liveStep —— one frame; false once the feed or the request is over.
func liveStep(w http.ResponseWriter, frames <-chan []byte, done <-chan struct{}) bool {
	select {
	case frame, open := <-frames:
		return open && writeAndFlush(w, frame)
	case <-done:
		return false
	}
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
