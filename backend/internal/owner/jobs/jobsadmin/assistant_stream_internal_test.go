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

// tickAlive —— run one tick and fail if it ended the stream (it should survive a normal push, a
// quiet stretch and a session lapse alike).
func tickAlive(t *testing.T, s *cueFeedStream) {
	t.Helper()
	if !s.tick(context.Background(), time.Now()) {
		t.Fatal("tick ended the stream unexpectedly")
	}
}

func wantFrame(t *testing.T, frame, id, text string) {
	t.Helper()
	if !strings.Contains(frame, id) || !strings.Contains(frame, text) {
		t.Fatalf("frame %q missing id %q / text %q", frame, id, text)
	}
}

// TestTickEmitsEventsAsFrames —— a tick with new events writes one SSE frame per event, each with
// its seq as the id (so a reconnect resumes) and its text as data, and advances the cursor.
func TestTickEmitsEventsAsFrames(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool {
		frames = append(frames, string(b))
		return true
	})
	mustPush(t, fx.store, "h1", cues.KindHeard, "how do you isolate untrusted code?")
	mustPush(t, fx.store, "c1", cues.KindCue, "key: sandbox")

	tickAlive(t, fx.s)
	if len(frames) != 2 {
		t.Fatalf("got %d frames, want 2: %q", len(frames), frames)
	}
	wantFrame(t, frames[0], "id: 1\n", "untrusted code")
	wantFrame(t, frames[1], "id: 2\n", "sandbox")
	if fx.s.since != 2 {
		t.Fatalf("cursor = %d, want 2", fx.s.since)
	}
}

// TestTickPingsAfterQuiet —— with no new events and the last write older than sse.Ping, a tick
// sends a keep-alive comment; a fresh last sends nothing.
func TestTickPingsAfterQuiet(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool {
		frames = append(frames, string(b))
		return true
	})

	fx.s.last = time.Now()
	fx.s.tick(context.Background(), time.Now())
	if len(frames) != 0 {
		t.Fatalf("fresh last: %q, want no frame", frames)
	}
	fx.s.last = time.Now().Add(-time.Minute)
	fx.s.tick(context.Background(), time.Now())
	if len(frames) != 1 || frames[0] != ": ping\n\n" {
		t.Fatalf("after quiet: %q, want one ping comment", frames)
	}
}

// TestTickStopsWhenClientGone —— once a write fails (the phone closed it), the tick ends it.
func TestTickStopsWhenClientGone(t *testing.T) {
	t.Parallel()
	fx := streamWith(t, func([]byte) bool { return false })
	mustPush(t, fx.store, "c1", cues.KindCue, "answer")
	if fx.s.tick(context.Background(), time.Now()) {
		t.Fatal("tick kept the stream alive after the client was gone")
	}
}

// TestTickEmitsEndedWhenSessionLapses —— once cards have streamed, a tick that finds the session no
// longer live (prepare's activeKey lapsed with no more pushes — the interview stopped) writes one
// `ended` frame so the phone clears its cards, then only pings. Without it the phone keeps the last
// cards on screen after the interview ends.
func TestTickEmitsEndedWhenSessionLapses(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool {
		frames = append(frames, string(b))
		return true
	})
	mustPush(t, fx.store, "c1", cues.KindCue, "answer")
	tickAlive(t, fx.s) // delivers the card, marks the stream active

	fx.mr.FastForward(4 * time.Minute) // the interview stops; the session's activeKey lapses
	frames = nil
	tickAlive(t, fx.s)
	if len(frames) != 1 || !strings.Contains(frames[0], "event: ended") {
		t.Fatalf("after session lapse: %q, want one `ended` frame", frames)
	}

	// The clear is sent once: a later quiet tick does not repeat it.
	frames = nil
	fx.s.last = time.Now()
	tickAlive(t, fx.s)
	if len(frames) != 0 {
		t.Fatalf("ended repeated: %q, want none", frames)
	}
}

// TestTickClearsOnConnectWithNoLiveSession —— a page that connects (or reconnects after a restart)
// when no interview is live may still hold the last session's cards; the first tick sends one
// `ended` so it clears, and does not repeat it.
func TestTickClearsOnConnectWithNoLiveSession(t *testing.T) {
	t.Parallel()
	var frames []string
	fx := streamWith(t, func(b []byte) bool {
		frames = append(frames, string(b))
		return true
	})
	fx.mr.FastForward(4 * time.Minute) // no live session by the time the stream first ticks

	tickAlive(t, fx.s)
	if len(frames) != 1 || !strings.Contains(frames[0], "event: ended") {
		t.Fatalf("connect with no session: %q, want one `ended` frame", frames)
	}

	frames = nil
	fx.s.last = time.Now()
	tickAlive(t, fx.s)
	if len(frames) != 0 {
		t.Fatalf("ended repeated: %q, want none", frames)
	}
}
