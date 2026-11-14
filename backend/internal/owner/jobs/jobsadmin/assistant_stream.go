// assistant_stream.go —— the cue feed as a Server-Sent Events stream. The phone's /cue page (and
// the admin view) holds one long-lived connection open instead of polling; the server pushes each
// new event and sends a comment-line ping through quiet stretches so a proxy does not end the
// stream as idle. On a drop, EventSource reconnects and passes the last seq (?since=), and
// store.Since serves the whole feed when that cursor sits above a reset feed, so a page left open
// across a feed expiry recovers on its own.

package jobsadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/sse"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
)

// cueTick —— how often the stream checks the feed for new pushes. A streamed cue pushes every
// ~300ms, so this keeps the card growing without a tight loop.
// ponytail: a server-side tick, one Redis read per tick per open stream — swap in a Redis pub/sub
// if many phones ever watch one owner at once.
const cueTick = 400 * time.Millisecond

func cueStream(store *cues.Store, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sse.Headers(w)
		rc := http.NewResponseController(w)
		write := func(b []byte) bool {
			if err := rc.SetWriteDeadline(time.Now().Add(sse.WriteBudget)); err != nil {
				log.Warn("cue stream: write deadline not extendable", "err", err)
			}
			return sse.WriteAndFlush(w, b)
		}
		if !write(sse.Opening("retry: 1000\n: cue\n")) {
			return
		}
		s := &cueFeedStream{
			store: store, log: log, owner: authmw.OwnerIDFrom(r.Context()),
			write: write, since: parseSince(r),
		}
		s.run(r.Context())
	}
}

// cueFeedStream —— one open stream: its source, whom for, how it writes, how far it has sent
// (since), when it last wrote (last), whether a session is live (active) and whether the phone has
// been told to clear (cleared) — so it sends exactly one `ended` per dead stretch, including when a
// page connects to no live session holding stale cards. Field order is tuned for pointer packing.
type cueFeedStream struct {
	store   *cues.Store
	log     *slog.Logger
	write   func([]byte) bool
	last    time.Time
	owner   string
	since   int64
	active  bool
	cleared bool
}

// run —— the stream loop: poll the feed every cueTick (time.After, not a ticker: this is a
// request-scoped stream that ends with the connection, not a scheduler job), until the client goes
// or the request ends.
func (s *cueFeedStream) run(ctx context.Context) {
	s.last = time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-time.After(cueTick):
			if !s.tick(ctx, now) {
				return
			}
		}
	}
}

// tick —— while a session is live, emit any new cards; when a live session has just lapsed (the
// interview stopped), emit one `ended` frame so the phone clears its cards; otherwise ping to keep
// the stream alive. false ends the stream.
func (s *cueFeedStream) tick(ctx context.Context, now time.Time) bool {
	live, err := s.store.SessionActive(ctx, s.owner)
	if err != nil {
		s.log.Error("cue stream active", logErrKey, err)
		return true // transient; keep the stream and retry on the next tick
	}
	if live {
		s.active, s.cleared = true, false
		return s.emitNew(ctx, now)
	}
	// Not live: if the phone may be showing cards (a session lapsed, or it connected to no live
	// session still holding the last session's cards), tell it to clear — once per dead stretch.
	if s.active || !s.cleared {
		s.active, s.cleared = false, true
		s.since = 0 // the next session restarts seq at 1; read it from the top
		s.last = now
		return s.write([]byte("event: ended\ndata: {}\n\n"))
	}
	return s.keepAlive(now)
}

// emitNew —— write any cards pushed since the cursor, else keep the stream alive with a ping.
func (s *cueFeedStream) emitNew(ctx context.Context, now time.Time) bool {
	events, err := s.store.Since(ctx, s.owner, s.since)
	if err != nil {
		s.log.Error("cue stream read", logErrKey, err)
		return true // transient; keep the stream and retry on the next tick
	}
	if len(events) > 0 {
		return s.emit(events, now)
	}
	return s.keepAlive(now)
}

// keepAlive —— a comment ping after sse.Ping of quiet so a proxy does not end the idle stream.
func (s *cueFeedStream) keepAlive(now time.Time) bool {
	if now.Sub(s.last) < sse.Ping {
		return true
	}
	s.last = now
	return s.write([]byte(": ping\n\n"))
}

// emit —— write each event as an SSE frame (id = seq, so a reconnect resumes) and advance the
// cursor; false once the client is gone.
func (s *cueFeedStream) emit(events []cues.Event, now time.Time) bool {
	for i := range events {
		frame, err := cueFrame(&events[i])
		if err != nil {
			s.log.Error("cue stream encode", logErrKey, err)
			continue
		}
		if !s.write(frame) {
			return false
		}
		s.since = events[i].Seq
	}
	s.last = now
	return true
}

// cueFrame —— one event as an SSE frame: id lets EventSource resume, data carries the JSON.
func cueFrame(e *cues.Event) ([]byte, error) {
	data, err := json.Marshal(e)
	if err != nil {
		return nil, fmt.Errorf("cue frame: %w", err)
	}
	return fmt.Appendf(nil, "id: %d\ndata: %s\n\n", e.Seq, data), nil
}
