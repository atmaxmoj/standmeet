// microsite_store_socket.go —— GET /api/v1/pages/{slug}/store/stream: an open page hears when its
// store changes (docs/design/scenario-s2-collaborative-writing.md, *Live updates*).
//
// The stream carries no content, only `event: changed`. The page then reads the store through the
// ordinary GET, so the read rule (the page's access rule, pending documents hidden) lives in one
// place. Same gate as the GET (opensGate).
//
// A stream ends itself after storeStreamLifetime, cleanly. The server's write timeout (30s) would
// otherwise cut it mid-response, and through the app's proxy a cut stream left the browser's
// EventSource on a dead connection — no events, and no reconnect (measured 2026-10-02: a page never
// saw another visitor's passage). A clean end makes EventSource reconnect within seconds, and the
// SDK reads the store again on every (re)connect, so nothing written in the gap is missed.

package public

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// storeStreamLifetime —— how long one stream lives; under the server's 30s write timeout.
const storeStreamLifetime = 20 * time.Second

// StoreWatch —— wakes on each change of a page's store; release when done. ok=false: the process
// is at its cap of listeners, and the page should poll instead.
type StoreWatch func(ctx context.Context, slug string) (wake <-chan struct{}, release func(),
	ok bool, err error)

func (h *MicrositeStoreHandlers) stream() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		wake, release, ok, err := h.Watch(r.Context(), chi.URLParam(r, "slug"))
		if err != nil {
			h.writeStoreErr(w, "page store stream", err)
			return
		}
		defer release()
		w.Header().Set("Content-Type", "text/event-stream")
		// no-transform: the app's response compression would hold these small frames.
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("X-Accel-Buffering", "no")
		if !ok {
			writeAndFlush(w, []byte("event: poll\ndata: {}\n\n"))
			return
		}
		writeAndFlush(w, []byte("retry: 1000\n: store\n\n"))
		end := time.NewTimer(storeStreamLifetime)
		defer end.Stop()
		for storeStreamStep(w, wake, end.C, r.Context().Done()) {
		}
	}
}

// storeStreamStep —— one change; false once the stream's lifetime or the request is over.
func storeStreamStep(
	w http.ResponseWriter, wake <-chan struct{}, end <-chan time.Time, done <-chan struct{},
) bool {
	select {
	case <-wake:
		return writeAndFlush(w, []byte("event: changed\ndata: {}\n\n"))
	case <-end:
		return false
	case <-done:
		return false
	}
}
