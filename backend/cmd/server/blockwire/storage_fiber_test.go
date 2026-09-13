// storage_fiber_test.go — the per-fiber schema key (rule 3). A storing block's schema is keyed
// by the session's fiber, so two fibers of one block land in two schemas; an empty fiber keeps
// the block's legacy single schema so an un-updated block is unchanged.

package blockwire

import "testing"

func TestBoundBlockStore_sid(t *testing.T) {
	t.Parallel()
	b := boundBlockStore{blockID: "calendar.book"}
	cases := []struct {
		name, fiber, want string
	}{
		{"empty fiber → legacy single schema (unchanged)", "", "calendar.book"},
		{"bundle fiber → per-fiber schema", "b_bundleA", "b_bundleA_calendar.book"},
		{"root fiber → per-owner schema", "root_own1", "root_own1_calendar.book"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := b.sid(c.fiber); got != c.want {
				t.Fatalf("sid(%q) = %q, want %q", c.fiber, got, c.want)
			}
		})
	}
}

// TestBoundBlockStore_sid_TwoFibersDiffer — the crux of item 6: two fibers of one block must key
// to two different schemas (else they share one, and there is no isolation to speak of).
func TestBoundBlockStore_sid_TwoFibersDiffer(t *testing.T) {
	t.Parallel()
	b := boundBlockStore{blockID: "calendar.book"}
	if b.sid("b_A") == b.sid("b_B") {
		t.Fatalf("two fibers keyed to one schema %q — they would share a store", b.sid("b_A"))
	}
}
