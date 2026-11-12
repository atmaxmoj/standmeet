package cues_test

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
)

func newStore(t *testing.T) (*miniredis.Miniredis, *cues.Store) {
	t.Helper()
	mr := miniredis.RunT(t)
	return mr, cues.New(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
}

func push(t *testing.T, st *cues.Store, owner, id, text string) {
	t.Helper()
	err := st.Push(context.Background(), owner, &cues.Event{ID: id, Kind: cues.KindCue, Text: text})
	if err != nil {
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

// TestSinceRecoversAfterFeedReset —— the feed's Redis keys expire after 12h; the seq counter then
// restarts at 1. A long-lived /cue page (or the admin view) holds its last-seen seq in memory and
// only ever raises it, so after a reset its cursor sits above the restarted feed. It must still
// receive the new low-seq events — not poll an empty feed forever. (Bug: the owner opened /cue on a
// phone and saw nothing, because the feed had expired and restarted while the page stayed open.)
func TestSinceRecoversAfterFeedReset(t *testing.T) {
	t.Parallel()
	mr, st := newStore(t)
	const owner = "owner-1"
	push(t, st, owner, "a1", "one")
	push(t, st, owner, "a2", "two")
	push(t, st, owner, "a3", "three")
	cursor := since(t, st, owner, 0)[2].Seq // the reader's in-memory cursor: the last seq it saw

	mr.FastForward(13 * time.Hour)          // both the list and the seq counter expire
	push(t, st, owner, "b1", "after reset") // INCR on the vanished counter yields seq 1 again

	got := since(t, st, owner, cursor) // the reader keeps polling with its old, higher cursor
	if len(got) != 1 || got[0].Text != "after reset" {
		t.Fatalf("stuck after reset: since(%d) = %+v, want [after reset]", cursor, got)
	}
}

// TestSinceReturnsOnlyNewerInSteadyState —— the ordinary path: a caught-up reader gets nothing, a
// reader one behind gets exactly the one it missed. Guards the reset fix from degrading into
// "always return everything".
func TestSinceReturnsOnlyNewerInSteadyState(t *testing.T) {
	t.Parallel()
	_, st := newStore(t)
	const owner = "owner-2"
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
