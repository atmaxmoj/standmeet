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

func streamWith(t *testing.T, write func([]byte) bool) (*cueFeedStream, *cues.Store) {
	t.Helper()
	store := cues.New(redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()}))
	s := &cueFeedStream{store: store, log: slog.New(slog.DiscardHandler), owner: "o1", write: write}
	return s, store
}

func mustPush(t *testing.T, store *cues.Store, id, kind, text string) {
	t.Helper()
	e := &cues.Event{ID: id, Kind: kind, Text: text}
	if err := store.Push(context.Background(), "o1", e); err != nil {
		t.Fatalf("push %s: %v", id, err)
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
	s, store := streamWith(t, func(b []byte) bool {
		frames = append(frames, string(b))
		return true
	})
	mustPush(t, store, "h1", cues.KindHeard, "how do you isolate untrusted code?")
	mustPush(t, store, "c1", cues.KindCue, "key: sandbox")

	if alive := s.tick(context.Background(), time.Now()); !alive {
		t.Fatal("tick ended the stream on a normal push")
	}
	if len(frames) != 2 {
		t.Fatalf("got %d frames, want 2: %q", len(frames), frames)
	}
	wantFrame(t, frames[0], "id: 1\n", "untrusted code")
	wantFrame(t, frames[1], "id: 2\n", "sandbox")
	if s.since != 2 {
		t.Fatalf("cursor = %d, want 2", s.since)
	}
}

// TestTickPingsAfterQuiet —— with no new events and the last write older than sse.Ping, a tick
// sends a keep-alive comment; a fresh last sends nothing.
func TestTickPingsAfterQuiet(t *testing.T) {
	t.Parallel()
	var frames []string
	s, _ := streamWith(t, func(b []byte) bool {
		frames = append(frames, string(b))
		return true
	})

	s.last = time.Now()
	s.tick(context.Background(), time.Now())
	if len(frames) != 0 {
		t.Fatalf("fresh last: %q, want no frame", frames)
	}
	s.last = time.Now().Add(-time.Minute)
	s.tick(context.Background(), time.Now())
	if len(frames) != 1 || frames[0] != ": ping\n\n" {
		t.Fatalf("after quiet: %q, want one ping comment", frames)
	}
}

// TestTickStopsWhenClientGone —— once a write fails (the phone closed it), the tick ends it.
func TestTickStopsWhenClientGone(t *testing.T) {
	t.Parallel()
	s, store := streamWith(t, func([]byte) bool { return false })
	mustPush(t, store, "c1", cues.KindCue, "answer")
	if s.tick(context.Background(), time.Now()) {
		t.Fatal("tick kept the stream alive after the client was gone")
	}
}
