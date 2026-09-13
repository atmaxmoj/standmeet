// fiber_id_test.go — the per-fiber storage identity derivation (rule 3). White-box: FiberID
// reads the bundle fields the exposure walk caches (bundleID/bundleBound), which are unexported.

package registry //nolint:testpackage // white-box: reads unexported bundle fields

import "testing"

func TestAssembleInput_FiberID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   *AssembleInput
		want string
	}{
		{
			name: "bound to a bundle → keyed by the bundle",
			in:   &AssembleInput{OwnerID: "own1", bundleID: "bun1", bundleBound: true},
			want: "b_bun1",
		},
		{
			name: "no bundle → per-owner root (not the old cross-owner shared bucket)",
			in:   &AssembleInput{OwnerID: "own1"},
			want: "root_own1",
		},
		{
			name: "bound but empty bundle id → falls back to per-owner root",
			in:   &AssembleInput{OwnerID: "own1", bundleBound: true, bundleID: ""},
			want: "root_own1",
		},
		{
			name: "no owner (should not happen for a mounted storing block) → root",
			in:   &AssembleInput{},
			want: "root",
		},
		{
			name: "nil input → root",
			in:   nil,
			want: "root",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := c.in.FiberID(); got != c.want {
				t.Fatalf("FiberID() = %q, want %q", got, c.want)
			}
		})
	}
}

// TestFiberID_TwoBundlesDiffer — two different bundles for one owner must key to two
// different fibers (the whole point of item 6: two schemas, not one shared).
func TestFiberID_TwoBundlesDiffer(t *testing.T) {
	t.Parallel()
	a := (&AssembleInput{OwnerID: "own1", bundleID: "A", bundleBound: true}).FiberID()
	b := (&AssembleInput{OwnerID: "own1", bundleID: "B", bundleBound: true}).FiberID()
	if a == b {
		t.Fatalf("two bundles derived the same fiber id %q — they would share one schema", a)
	}
}
