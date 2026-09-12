// slot_test.go —— Definition 44's other side: a key whose value is a SINGLE BINDING, plus the
// two properties that make a binding's identity observable.
//
// A table of entries commutes (each registration takes an entry of its own) and may therefore be
// reverted in any order. A slot does not: two claims on one slot do not commute, and §3.4.2 says
// the order of a non-commutative key "has to be imposed from outside the effects". This codebase
// imposes it the strongest way available — by refusing the second claim — which is what
// `plugin.NewResolver` already does for two suppliers of one seam.

package effect_test

import (
	"maps"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Definition 44 — a non-commutative key is refused, not ordered ──────────────────────────

func TestSingleSlotKeyRefusesASecondClaim(t *testing.T) {
	t.Parallel()
	var slot effect.Slot

	_, err := slot.Claim("google-calendar")
	require.NoError(t, err)

	_, err = slot.Claim("caldav")
	require.ErrorIs(t, err, effect.ErrSlotTaken,
		"a single-binding key is not commutative (Def 44), so its order must be imposed from "+
			"outside the effects — this codebase imposes it by refusing, as NewResolver does "+
			"for two suppliers of one seam")
}

func TestSlotIsClaimableAgainAfterItsInverseRuns(t *testing.T) {
	t.Parallel()
	var slot effect.Slot

	release, err := slot.Claim("google-calendar")
	require.NoError(t, err)
	require.NoError(t, release())

	_, err = slot.Claim("caldav")
	require.NoError(t, err, "the claim's inverse frees the slot — otherwise a swap is impossible "+
		"and the seam could never change supplier")
}

// ── Cordis assertActive ────────────────────────────────────────────────────────────────────

func TestEffectAfterUnloadIsRefused(t *testing.T) {
	t.Parallel()
	var s effect.Scope
	require.NoError(t, s.Unload())

	_, err := s.Effect("late", func() (effect.Dispose, error) {
		return func() error { return nil }, nil
	})
	require.ErrorIs(t, err, effect.ErrInactive,
		"an effect registered after the accumulator has run is one nothing will ever revert")
	require.False(t, s.Active())
}

// ── epoch is identity, not presence ────────────────────────────────────────────────────────

func TestEpochChangesWhenAProviderIsSwapped(t *testing.T) {
	t.Parallel()
	var s effect.Scope

	s.Bind(map[string]string{"calendar": "uid-google"})
	first := s.Epoch()
	require.NotEmpty(t, first, "all dependencies bound → an active epoch")

	changed := s.Bind(map[string]string{"calendar": "uid-caldav"})
	require.True(t, changed,
		"the same NAME bound to a different provider is a different epoch — the case a presence "+
			"check misses, and the reason Cordis concatenates uids rather than counting")
	require.NotEqual(t, first, s.Epoch())
}

func TestEpochIsEmptyWhenADependencyIsMissing(t *testing.T) {
	t.Parallel()
	var s effect.Scope
	s.Bind(map[string]string{"calendar": "uid-google", "mail": ""})
	require.Empty(t, s.Epoch(), "any missing implementation makes the epoch INACTIVE")
}

// ── hot replacement ────────────────────────────────────────────────────────────────────────

func TestReloadLeavesNoResidue(t *testing.T) {
	t.Parallel()
	w := newWorld()

	var first effect.Scope
	mustEffect(t, &first, "v1", set(w, "impl", "v1"))
	afterFirstLoad := maps.Clone(w)
	require.NoError(t, first.Unload())

	var second effect.Scope
	mustEffect(t, &second, "v1-again", set(w, "impl", "v1"))

	require.True(t, sameUnder(afterFirstLoad, w, []string{"impl", "seeded"}),
		"unload + reload reaches the same state as loading once from γ₀; a residue would show "+
			"up here as a difference that only a second load can produce. Read at ≃, because a "+
			"reload legitimately re-creates things with fresh identities (§3.3.2's generative "+
			"name)")
}
