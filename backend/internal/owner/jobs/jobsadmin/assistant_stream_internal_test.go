package jobsadmin

import (
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
)

// streamFix —— a stream wired to its own miniredis-backed store, with a live session started.
type streamFix struct {
	s     *cueFeedStream
	store *cues.Store
	mr    *miniredis.Miniredis
}

func streamWith(t *testing.T, write func([]byte) bool) streamFix {
	t.Helper()
	mr := miniredis.RunT(t)
	store := cues.New(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
	// prepare ran: the session is live (reads gate on it), so pushed cards reach the stream.
	if err := store.StartSession(context.Background(), "o1"); err != nil {
		t.Fatalf("start session: %v", err)
	}
	s := &cueFeedStream{store: store, log: slog.New(slog.DiscardHandler), owner: "o1", write: write}
	return streamFix{s: s, store: store, mr: mr}
}

func mustPush(t *testing.T, store *cues.Store, id, kind, text string) {
	t.Helper()
	e := &cues.Event{ID: id, Kind: kind, Text: text}
	if err := store.Push(context.Background(), "o1", e); err != nil {
		t.Fatalf("push %s: %v", id, err)
	}
}

// tickAlive —— run one tick and fail if it ended the stream (it should survive a push, a quiet
// stretch and a session lapse alike).
func tickAlive(t *testing.T, s *cueFeedStream) {
	t.Helper()
	if !s.tick(context.Background(), time.Now()) {
		t.Fatal("tick ended the stream unexpectedly")
	}
}

// TestTickSendsCurrentSet —— a tick writes one frame holding the whole current card set (every id's
// text), so the phone mirrors what to show now.
func TestTickSendsCurrentSet(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool { frames = append(frames, string(b)); return true })
	mustPush(t, fx.store, "h1", cues.KindHeard, "how do you isolate untrusted code?")
	mustPush(t, fx.store, "c1", cues.KindCue, "key: sandbox")

	tickAlive(t, fx.s)
	if len(frames) != 1 {
		t.Fatalf("got %d frames, want 1: %q", len(frames), frames)
	}
	for _, want := range []string{"data: [", "untrusted code", "sandbox"} {
		if !strings.Contains(frames[0], want) {
			t.Fatalf("frame %q missing %q", frames[0], want)
		}
	}
}

// TestTickClearsWhenSessionLapses —— once cards have streamed, a tick that finds the session no
// longer live (the interview stopped) sends an empty set, so the phone clears, no special signal;
// a later unchanged tick does not resend it. Without it the phone keeps the last cards on screen.
func TestTickClearsWhenSessionLapses(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool { frames = append(frames, string(b)); return true })
	mustPush(t, fx.store, "c1", cues.KindCue, "answer")
	tickAlive(t, fx.s) // delivers the card

	fx.mr.FastForward(4 * time.Minute) // the interview stops; the session's activeKey lapses
	frames = nil
	tickAlive(t, fx.s)
	if len(frames) != 1 || !strings.Contains(frames[0], "data: []") {
		t.Fatalf("after lapse: %q, want one empty-set frame", frames)
	}

	frames = nil
	fx.s.wroteAt = time.Now()
	tickAlive(t, fx.s)
	if len(frames) != 0 {
		t.Fatalf("empty set resent: %q, want none", frames)
	}
}

// TestTickPingsWhenUnchanged —— with the set unchanged since the last frame, a tick sends nothing
// until sse.Ping of quiet, then a keep-alive comment.
func TestTickPingsWhenUnchanged(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool { frames = append(frames, string(b)); return true })
	mustPush(t, fx.store, "c1", cues.KindCue, "answer")
	tickAlive(t, fx.s) // sends the set, records it

	frames = nil
	fx.s.wroteAt = time.Now()
	tickAlive(t, fx.s)
	if len(frames) != 0 {
		t.Fatalf("fresh write: %q, want no frame", frames)
	}
	fx.s.wroteAt = time.Now().Add(-time.Minute)
	tickAlive(t, fx.s)
	if len(frames) != 1 || frames[0] != ": ping\n\n" {
		t.Fatalf("after quiet: %q, want one ping", frames)
	}
}

// TestTickStopsWhenClientGone —— once a write fails (the phone closed it) the tick ends the stream.
func TestTickStopsWhenClientGone(t *testing.T) {
	t.Parallel()
	fx := streamWith(t, func([]byte) bool { return false })
	mustPush(t, fx.store, "c1", cues.KindCue, "answer")
	if fx.s.tick(context.Background(), time.Now()) {
		t.Fatal("tick kept the stream alive after the client was gone")
	}
}
