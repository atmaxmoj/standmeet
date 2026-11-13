package cues_test

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
)

func newStore(t *testing.T) *cues.Store {
	t.Helper()
	return cues.New(redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()}))
}

func push(t *testing.T, st *cues.Store, owner, id, text string) {
	t.Helper()
	e := &cues.Event{ID: id, Kind: cues.KindCue, Text: text}
	if err := st.Push(context.Background(), owner, e); err != nil {
		t.Fatalf("push %s: %v", id, err)
	}
}

func since(t *testing.T, st *cues.Store, owner string, seq int64) []cues.Event {
	t.Helper()
	got, err := st.Since(context.Background(), owner, seq)
	if err != nil {
		t.Fatalf("since(%d): %v", seq, err)
	}
	return got
}

func start(t *testing.T, st *cues.Store, owner string) {
	t.Helper()
	if err := st.StartSession(context.Background(), owner); err != nil {
		t.Fatalf("start session: %v", err)
	}
}

// TestSinceEmptyWithoutSession —— the screen assistant is a per-owner singleton: with no interview
// underway (no StartSession), reads return nothing even if something was pushed — /cue stays empty
// between interviews, and a stray push never shows.
func TestSinceEmptyWithoutSession(t *testing.T) {
	t.Parallel()
	st := newStore(t)
	const owner = "o-nosession"
	push(t, st, owner, "stray", "a push with no session") // no StartSession first
	if got := since(t, st, owner, 0); len(got) != 0 {
		t.Fatalf("without a session: since(0) = %+v, want empty", got)
	}
}

// TestSinceReturnsOnlyNewerInSteadyState —— during a live session: a caught-up reader gets nothing,
// a reader one behind gets exactly the one it missed.
func TestSinceReturnsOnlyNewerInSteadyState(t *testing.T) {
	t.Parallel()
	st := newStore(t)
	const owner = "o-steady"
	start(t, st, owner)
	push(t, st, owner, "a", "one")
	push(t, st, owner, "b", "two")
	push(t, st, owner, "c", "three")
	if got := since(t, st, owner, 3); len(got) != 0 {
		t.Fatalf("caught-up reader: since(3) = %+v, want none", got)
	}
	got := since(t, st, owner, 2)
	if len(got) != 1 || got[0].Text != "three" {
		t.Fatalf("one behind: since(2) = %+v, want [three]", got)
	}
}

// TestSinceRecoversAcrossSessionRestart —— a /cue page left open across a new interview: the next
// StartSession clears the feed and seq restarts at 1, but the page's cursor still sits at the old
// session's last seq. Since treats a cursor above the feed's max as a reset and serves the fresh
// cards, so the open page catches the new interview instead of polling empty.
func TestSinceRecoversAcrossSessionRestart(t *testing.T) {
	t.Parallel()
	st := newStore(t)
	const owner = "o-restart"
	start(t, st, owner)
	push(t, st, owner, "a1", "one")
	push(t, st, owner, "a2", "two")
	push(t, st, owner, "a3", "three")
	cursor := since(t, st, owner, 0)[2].Seq // the open page's cursor = last seq it saw (3)

	start(t, st, owner) // a new interview: feed cleared, seq restarts at 1
	push(t, st, owner, "b1", "after restart")

	got := since(t, st, owner, cursor) // the page keeps polling with its old, higher cursor
	if len(got) != 1 || got[0].Text != "after restart" {
		t.Fatalf("across restart: since(%d) = %+v, want [after restart]", cursor, got)
	}
}
