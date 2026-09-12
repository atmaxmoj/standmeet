// effect_test.go —— one test per formal result in *Spatiotemporal Composability* §3
// (arXiv:2608.25512). Design + the full mapping: `docs/design/plugin/effects.md`.
//
// **These are red by design.** The package is a contract; nothing is implemented. They are written
// first so that "the port is done" has a meaning other than someone saying so.
//
// The world Γ is a `map[string]string`, compared against a snapshot taken before anything ran —
// so an implementation cannot satisfy these by remembering what it was asked to undo.
//
// **Compared up to ≃, never by DeepEqual.** §3.3.2 rules that out in its first paragraph:
// Theorem 7's equality "is an idealization, because the physical state cannot be recovered as it
// stood", and a correct implementation is free to hand back a fresh generative name. Every
// comparison here goes through `sameUnder`, which is Definition 33 restricted to the keys the
// component declares — the part of the state no key binds is forgotten, and forgetting it is what
// makes Theorem 7 readable.

package effect_test

import (
	"errors"
	"maps"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// world —— Γ. Effects write into it; the tests assert on it directly.
type world map[string]string

func newWorld() world { return world{"seeded": "before-anything"} }

// set —— an effect function: writes one key, hands back the inverse that restores exactly what
// was there (which may be "was not present at all" — the inverse has to know that, and can only
// know it because it is built at the point of application; Definition 8).
func set(w world, k, v string) effect.Setup {
	return func() (effect.Dispose, error) {
		old, had := w[k]
		w[k] = v
		return func() error {
			if had {
				w[k] = old
			} else {
				delete(w, k)
			}
			return nil
		}, nil
	}
}

// mustEffect —— register an effect and fail the test if it is refused, discarding the handle.
// Used where the test is about the scope's recovery rather than about the individual handle;
// `theorem7_test.go` and `lifting_test.go` keep the handle where Theorem 15 is the point.
func mustEffect(t *testing.T, s *effect.Scope, label string, up effect.Setup) {
	t.Helper()
	_, err := s.Effect(label, up)
	require.NoError(t, err)
}

// ── Definition 8 — the inverse is returned at the point of application ──────────────────────

func TestSetupReturnsItsOwnInverse(t *testing.T) {
	t.Parallel()
	var s effect.Scope
	// The (nil, nil) is the POINT: Def 8 gives every effect an inverse, and a setup that yields
	// none must be refused rather than stored.
	noInverse := func() (effect.Dispose, error) { return nil, nil } //nolint:nilnil // see above
	_, err := s.Effect("no-inverse", noInverse)
	require.ErrorIs(t, err, effect.ErrNoInverse,
		"a setup yielding no inverse is not an effect function (Def 8) and must be refused, "+
			"not stored as an untrackable transformation")
}

// ── Theorem 7 — the soundness invariant φ(γ) ≃ γ₀ ──────────────────────────────────────────
//
// The property the whole port exists for. Note **≃, not =**: §3.3.2 says in as many words that
// the equality Theorem 7 asserts is an idealization, "because the physical state cannot be
// recovered as it stood" — `free` does not restore the heap layout, and "a generative name is not
// restored by the inverse that discards it, since the next creation draws a fresh one".
//
// A DeepEqual here would therefore **reject a correct implementation**: provisioning a block's
// schema and dropping it leaves a database that will hand out a different OID next time. The test
// that follows compares what the declared keys bind, through the operations those keys publish, and
// forgets the rest — which is the licence Definition 33 grants and the reason Theorem 7 is
// readable at all.

func TestUnloadRecoversTheInitialStateUpToObservation(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)

	var s effect.Scope
	mustEffect(t, &s, "a", set(w, keyAlpha, valOne))
	mustEffect(t, &s, "b", set(w, "beta", valTwo))
	mustEffect(t, &s, "c", set(w, "seeded", "overwritten"))
	require.NotEqual(t, before, map[string]string(w), "the effects actually changed the world")

	require.NoError(t, s.Unload())

	// Observed at the keys this component declared, through the operations those keys publish.
	observed := []string{keyAlpha, "beta", "seeded"}
	require.True(t, sameUnder(before, w, observed),
		"Thm 7 up to ≃: at every key an observer can name, the recovered state is "+
			"indistinguishable from γ₀ — a key overwritten is back, a key that did not exist "+
			"is "+
			"gone, and nothing outside those keys is asserted about")
}

// sameUnder —— σ ≃_S σ' (Def 33) for the map world: the two agree at every key of S, on
// presence as well as on value.
//
// Presence and not only value: Def 33 requires `dom(σ) ∩ S = dom(σ') ∩ S` before comparing,
// and dropping that half is how "the key is gone" and "the key is empty" stop being distinguishable
// — which is the one difference an uninstall has to get right.
func sameUnder(a, b world, keys []string) bool {
	for _, k := range keys {
		av, aok := a[k]
		bv, bok := b[k]
		if aok != bok || av != bv {
			return false
		}
	}
	return true
}

// ── Definition 9 — inverses accumulate as s ∘ t, so the later one runs first ────────────────

func TestRevertOrderIsLIFO(t *testing.T) {
	t.Parallel()
	var order []string
	push := func(name string) effect.Setup {
		return func() (effect.Dispose, error) {
			return func() error { order = append(order, name); return nil }, nil
		}
	}

	var s effect.Scope
	mustEffect(t, &s, "first", push("first"))
	mustEffect(t, &s, "second", push("second"))
	mustEffect(t, &s, "third", push("third"))
	require.NoError(t, s.Unload())

	require.Equal(t, []string{"third", "second", "first"}, order,
		"Def 9: composing effects accumulates s∘t, which applies the later inverse first")
}

// ── Definition 2 — recover resets φ to the identity ────────────────────────────────────────

func TestUnloadTwiceIsANoOp(t *testing.T) {
	t.Parallel()
	runs := 0
	var s effect.Scope
	mustEffect(t, &s, "once", func() (effect.Dispose, error) {
		return func() error { runs++; return nil }, nil
	})

	require.NoError(t, s.Unload())
	require.NoError(t, s.Unload())
	require.Equal(t, 1, runs, "recover resets φ to id; a second recover has nothing to run")
}

// ── §3.1.2 — a partially applied effect holds no residue ───────────────────────────────────
//
// **What "no residue" reaches, and what it does not.** Cordis's rule is `catch { dispose(); throw
// }` — it applies the inverses the failing setup had already REGISTERED. A setup that writes the
// world directly registers nothing, and §6.1 says what that location is: outside the system
// boundary, an operation "acts as id_Γ and is therefore neither tracked nor reverted". No
// accumulator can reach it, and an implementation claiming otherwise would be claiming to undo a
// `send`.
//
// So the property is about the registered half, and this test registers before it fails.

func TestFailedSetupRevertsItsOwnPartialWork(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	boom := errors.New("setup failed halfway")

	var s effect.Scope
	_, err := s.Effect("half", func() (effect.Dispose, error) {
		// The first half succeeds and is registered on the scope…
		if _, inner := s.Effect("half.first", set(w, "first-half", "installed")); inner != nil {
			return nil, inner
		}
		require.Equal(t, "installed", w["first-half"], "the first half really did run")
		// …and then the setup fails.
		return nil, boom
	})

	require.ErrorIs(t, err, boom)
	require.True(t, sameUnder(before, w, []string{"first-half", "seeded"}),
		"the registered half is withdrawn before the error returns, so a half-applied effect "+
			"leaves nothing behind for an Unload that will never come")
}

// The other side of the same boundary, stated so nobody mistakes the property above for a stronger
// one: a setup that writes past the boundary is NOT recovered, and cannot be.

func TestAWriteOutsideTheBoundaryIsNotRecoveredByAFailedSetup(t *testing.T) {
	t.Parallel()
	w := newWorld()
	boom := errors.New("setup failed halfway")

	var s effect.Scope
	_, err := s.Effect("untracked", func() (effect.Dispose, error) {
		w["written-directly"] = "x" // no inverse ever registered for this
		return nil, boom
	})

	require.ErrorIs(t, err, boom)
	require.Equal(t, "x", w["written-directly"],
		"§6.1: a location the system cannot revert is OUTSIDE the boundary — 'an operation on it "+
			"acts as id_Γ and is therefore neither tracked nor reverted'. Reporting this as "+
			"recovered would make Theorem 7 a claim the package cannot keep")
}

// ── Cordis _unload — one failing disposer does not strand the others ───────────────────────

func TestOneFailingDisposerDoesNotStrandTheOthers(t *testing.T) {
	t.Parallel()
	var ran []string
	ok := func(name string) effect.Setup {
		return func() (effect.Dispose, error) {
			return func() error { ran = append(ran, name); return nil }, nil
		}
	}
	bad := errors.New("this inverse is stuck")

	var s effect.Scope
	mustEffect(t, &s, "bottom", ok("bottom"))
	mustEffect(t, &s, "stuck", func() (effect.Dispose, error) {
		return func() error { return bad }, nil
	})
	mustEffect(t, &s, "top", ok("top"))

	err := s.Unload()
	require.ErrorIs(t, err, bad, "the failure is reported, not swallowed")
	require.Equal(t, []string{"top", "bottom"}, ran,
		"every other inverse still ran: aborting at the first failure would strand everything "+
			"registered beneath it")
}

// ── Theorem 43 — independent effects revert under ANY permutation ──────────────────────────
//
// Thm 45 gives independence outright for distinct keys, so this is the case the theorem covers.
// LIFO is required only where effects are NOT independent; an implementation that can only ever
// revert in registration order has not implemented Thm 43, it has implemented a stack.

func TestIndependentEffectsRevertInAnyOrder(t *testing.T) {
	t.Parallel()
	for _, perm := range [][]int{{0, 1, 2}, {2, 0, 1}, {1, 2, 0}, {2, 1, 0}} {
		w := newWorld()
		before := maps.Clone(w)
		const observed = 4 // three written keys plus the seed
		keys := make([]string, 0, observed)
		keys = append(keys, "k0", "k1", "k2")

		disposers := make([]effect.Dispose, len(keys))
		for i, k := range keys {
			up := set(w, k, "v")
			d, err := up()
			require.NoError(t, err)
			disposers[i] = d
		}
		for _, i := range perm {
			require.NoError(t, disposers[i]())
		}
		require.True(t, sameUnder(before, w, append(keys, "seeded")),
			"Thm 43: effects at distinct keys are independent (Thm 45), so any permutation of "+
				"their inverses reaches γ₀ (up to ≃, at the keys they name) — permutation %v", perm)
	}
}

// ── Theorem 45 — distinct keys are independent ─────────────────────────────────────────────

func TestDistinctKeysDoNotDisturbEachOther(t *testing.T) {
	t.Parallel()
	w := newWorld()

	var a, b effect.Scope
	mustEffect(t, &a, "a1", set(w, "owned-by-a", valOne))
	mustEffect(t, &b, "b1", set(w, "owned-by-b", valOne))
	mustEffect(t, &a, "a2", set(w, "also-a", valTwo))

	require.NoError(t, a.Unload())

	require.Equal(t, "1", w["owned-by-b"],
		"unloading one component leaves another's writes exactly as they were, even though the "+
			"registrations interleaved")
	require.NotContains(t, w, "owned-by-a")
	require.NotContains(t, w, "also-a")
}
