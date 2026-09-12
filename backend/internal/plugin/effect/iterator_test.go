// iterator_test.go —— §3.1.3: Definition 17/18 and **Theorem 16**. Red by design.
//
// The running example is a block mount, because that is the sequence this repo actually has:
// provision storage → start the sandbox → register the tools. Three steps, each with its own
// inverse, and a failure at step three that must leave none of step one or two behind.

package effect_test

import (
	"errors"
	"maps"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// recordingUndo —— an inverse that snapshots the state it was HANDED before undoing.
//
// Theorem 16.1 is a claim about that state, so the snapshot is the measurement: it is not enough
// that the round trip lands, each inverse must meet what its own application produced.
func recordingUndo(w world, key string, seen *[]map[string]string) effect.Dispose {
	return func() error {
		*seen = append(*seen, maps.Clone(w))
		delete(w, key)
		return nil
	}
}

// mountSteps —— a three-step load over the map world, recording the state each inverse was
// handed. `failAt` (1-based, 0 = never) makes one step fail.
func mountSteps(w world, seen *[]map[string]string, failAt int) effect.Step {
	step := func(n int, key string, next func() effect.Step) effect.Step {
		return func() (effect.Dispose, effect.Step, error) {
			if failAt == n {
				return nil, nil, errors.New("step failed")
			}
			w[key] = "on"
			undo := recordingUndo(w, key, seen)
			if next == nil {
				return undo, nil, nil
			}
			return undo, next(), nil
		}
	}
	third := func() effect.Step { return step(3, "tools", nil) }
	second := func() effect.Step { return step(2, seamSandbox, third) }
	return step(1, seamStorage, second)
}

// ── Definition 18 — the sequence runs, and one Unload reverts all of it ────────────────────

func TestRunTakesEveryStepAndUnloadRevertsThemAll(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	var seen []map[string]string

	var s effect.Scope
	require.NoError(t, s.Run(effect.Sequence(mountSteps(w, &seen, 0))))
	require.Equal(t, "on", w[seamStorage])
	require.Equal(t, "on", w[seamSandbox])
	require.Equal(t, "on", w["tools"])

	require.NoError(t, s.Unload())
	require.True(t, sameUnder(before, w, []string{seamStorage, seamSandbox, "tools", "seeded"}),
		"unloading reverts the whole sequence, not the last step")
}

// ── Theorem 16.1 — each revert recovers the context state ITS application ran against ──────
//
// The sharp one. It is not enough that the sequence ends where it began; the theorem says each
// inverse individually meets the state its own application produced. An implementation that
// reverted in the right order but ran the inverses against a state some other step had moved would
// satisfy the round trip and fail this — and that is the arrangement where an inverse silently
// deletes something a later step created.

func TestEachInverseMeetsTheStateItsOwnApplicationProduced(t *testing.T) {
	t.Parallel()
	w := newWorld()
	var seen []map[string]string

	var s effect.Scope
	require.NoError(t, s.Run(effect.Sequence(mountSteps(w, &seen, 0))))
	require.NoError(t, s.Unload())

	require.Len(t, seen, 3)
	// LIFO: tools' inverse runs first, and at that moment storage+sandbox are still present —
	// exactly the state the tools step ran against.
	require.Contains(t, seen[0], "storage")
	require.Contains(t, seen[0], "sandbox")
	require.Contains(t, seen[0], "tools")
	// then sandbox's, with tools already withdrawn…
	require.Contains(t, seen[1], "storage")
	require.Contains(t, seen[1], "sandbox")
	require.NotContains(t, seen[1], "tools")
	// …and storage's last, alone.
	require.Contains(t, seen[2], "storage")
	require.NotContains(t, seen[2], "sandbox")
}

// ── Theorem 16.2 — every intermediate state satisfies the soundness invariant ──────────────

func TestEveryIntermediateStateSatisfiesTheInvariant(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)
	keys := []string{seamStorage, seamSandbox, "tools", "seeded"}

	// Stop after each step and check that unloading from *there* still recovers γ₀. Thm 16.2
	// says this holds at every intermediate state, not only at the end — which is what makes a
	// load interruptible at all.
	for taken := 1; taken <= 3; taken++ {
		w2 := newWorld()
		var s2 effect.Scope
		it2 := effect.Sequence(mountSteps(w2, new([]map[string]string), 0))
		for range taken {
			_, err := s2.Advance(it2)
			require.NoError(t, err)
		}
		require.NoError(t, s2.Unload())
		require.True(t, sameUnder(before, w2, keys),
			"stopped after %d step(s), unload still recovers γ₀", taken)
	}
}

// ── Definition 17's Maybe — the boundary between two consecutive iterations is observable
// ──

func TestAdvanceStopsAtTheBoundaryAndReportsWhetherMoreRemains(t *testing.T) {
	t.Parallel()
	w := newWorld()

	var s effect.Scope
	it := effect.Sequence(mountSteps(w, new([]map[string]string), 0))

	more, err := s.Advance(it)
	require.NoError(t, err)
	require.True(t, more, "Just(i): another iteration follows")
	require.Equal(t, "on", w[seamStorage])
	require.NotContains(t, w, "sandbox",
		"the boundary is real: step two has NOT run, so a load can be suspended here and the "+
			"accumulator recovers what the steps so far made and nothing more")

	more, err = s.Advance(it)
	require.NoError(t, err)
	require.True(t, more)

	more, err = s.Advance(it)
	require.NoError(t, err)
	require.False(t, more, "Nothing: the sequence is finished")
}

// ── a failing step reverts the steps already taken ─────────────────────────────────────────

func TestAFailingStepRevertsTheStepsAlreadyTaken(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)

	var s effect.Scope
	err := s.Run(effect.Sequence(mountSteps(w, new([]map[string]string), 3)))
	require.Error(t, err, "the third step failed")

	require.True(t, sameUnder(before, w, []string{seamStorage, seamSandbox, "tools", "seeded"}),
		"steps one and two are withdrawn — a half-mounted block is the state this whole file "+
			"exists to make unrepresentable")
}

// ── equation (19) — a plain effect is the degenerate iterator ──────────────────────────────

func TestOnceEmbedsAPlainEffectAsAnIterator(t *testing.T) {
	t.Parallel()
	w := newWorld()
	before := maps.Clone(w)

	var s effect.Scope
	require.NoError(t, s.Run(effect.Once(set(w, keyAlpha, valOne))))

	more, err := s.Advance(effect.Once(set(w, "beta", valTwo)))
	require.NoError(t, err)
	require.False(t, more, "eq (19): the first iteration already yields Nothing")

	require.NoError(t, s.Unload())
	require.True(t, sameUnder(before, w, []string{keyAlpha, "beta", "seeded"}),
		"the embedding carries 𝔈* into 𝔍* — Effect and Run are not two parallel worlds")
}
