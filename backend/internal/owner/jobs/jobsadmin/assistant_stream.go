// assistant_stream.go —— the cue feed as a Server-Sent Events stream. The /cue page and the
// admin view hold one connection open instead of polling. Each tick the server reads the cards
// to show now and, when they differ from the last frame, sends the whole set; the phone replaces
// its view with it. A lapsed session sends an empty set and the phone clears on its own — no
// "ended" signal, no cursor, no accumulation. Through quiet stretches the server pings so a proxy
// does not end the stream as idle.

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

// cueTick —— how often the stream checks the feed. A cue pushes every ~300ms, so this keeps the
// card growing without a tight loop.
// ponytail: one Redis read per tick per open stream; Redis pub/sub if many phones watch one owner.
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
			store: store, log: log, owner: authmw.OwnerIDFrom(r.Context()), write: write,
		}
		s.run(r.Context())
	}
}

// cueFeedStream —— one open stream: source, owner, how it writes, the JSON of the last set sent (to
// skip unchanged frames) and when it last wrote anything (to time pings).
type cueFeedStream struct {
	store   *cues.Store
	log     *slog.Logger
	write   func([]byte) bool
	wroteAt time.Time
	last    string
	owner   string
}

// run —— poll the feed every cueTick (time.After, not a ticker: a request-scoped stream that ends
// with the connection, not a scheduler job) until the client goes or the request ends.
func (s *cueFeedStream) run(ctx context.Context) {
	s.wroteAt = time.Now() // last starts empty: the first state always differs, so it is sent
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

// tick —— send the current card set when it changed since the last frame, else ping. false ends the
// stream (the client is gone).
func (s *cueFeedStream) tick(ctx context.Context, now time.Time) bool {
	cards, err := s.store.Current(ctx, s.owner)
	if err != nil {
		s.log.Error("cue stream read", logErrKey, err)
		return true // transient; keep the stream and retry on the next tick
	}
	data, err := json.Marshal(cards)
	if err != nil {
		s.log.Error("cue stream encode", logErrKey, err)
		return true
	}
	if string(data) == s.last {
		return s.keepAlive(now)
	}
	s.last, s.wroteAt = string(data), now
	return s.write(fmt.Appendf(nil, "data: %s\n\n", data))
}

// keepAlive —— a comment ping after sse.Ping of quiet so a proxy does not end the idle stream.
func (s *cueFeedStream) keepAlive(now time.Time) bool {
	if now.Sub(s.wroteAt) < sse.Ping {
		return true
	}
	s.wroteAt = now
	return s.write([]byte(": ping\n\n"))
}
