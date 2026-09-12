// loader_test.go —— the INTEGRATION layer: a declarative configuration reconciled into a
// running set of scopes. §5.2.1 of arXiv:2608.25512, modelled on Koishi's own
// `packages/loader/tests/loader.spec.ts` (MIT, © 2019-present Shigma), which is the reference for
// what an integration suite over this mechanism has to assert.
//
// **Red by design**, like effect_test.go. The mechanism and the loader are both contracts here.
//
// The four tests mirror the four in Koishi's loader spec, because those four are not arbitrary —
// each is one clause of Definition 81 or one theorem:
//
//	createApp   → a config tree becomes running fibers, each with its own config      (Def 81)
//	update      → a REPLACED config quiesces where a fresh load of it would have      (Thm 80)
//	self-update → a component revising itself is written back to its entry  (Def 81, both ways)
//	nesting     → group annotations compose down the tree                    (Def 81 isolate)
//
// Why an integration suite is separate from effect_test.go: those tests prove the mechanism holds.
// They cannot see whether the product *uses* it. This file is about the product's configuration
// being the thing the mechanism is driven by — the gap where a correct runtime still ends up with
// an orphaned schema because nothing asked it to revert.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// valBar —— an arbitrary config value; only its CHANGE matters, never its content.
const valBar = "bar"

// desired —— the configuration tree the owner has expressed. Entries, nestable, each with the
// six fields of Definition 81 that we can express today.
//
// Deliberately a plain value: the whole point of a declarative layer is that the desired state is
// data the owner can be shown and can edit, not a sequence of calls whose order matters.
func desired(entries ...effect.Entry) effect.Config { return effect.Config{Entries: entries} }

func entry(id string, cfg map[string]string) effect.Entry {
	return effect.Entry{ID: id, Config: cfg}
}

// ── Definition 81 — a config tree becomes running scopes ───────────────────────────────────

func TestLoadRealisesEveryEntry(t *testing.T) {
	t.Parallel()
	var l effect.Loader

	require.NoError(t, l.Apply(desired(
		entry("foo", nil),
		effect.Entry{
			ID:       "qux",
			Children: []effect.Entry{entry(valBar, map[string]string{"a": "1"})},
		},
	)))

	require.True(t, l.Active("foo"), "a declared entry is running")
	require.True(t, l.Active(valBar), "including one nested in a group")
	require.Equal(t, map[string]string{"a": "1"}, l.ConfigOf(valBar),
		"with the config its entry carries, not a default")
}

// ── Theorem 80 — the quiesced state is a function of the final configuration alone ─────────
//
// The single most valuable test in this file. It replaces the configuration wholesale — one entry
// disabled, one added, one reconfigured — and asserts the result, not the path. An implementation
// that reached a different state depending on the order it processed the diff would fail here,
// which is what makes "the owner cannot break it by clicking in an unusual order" a checked claim
// rather than a hope.

func TestReconcileReachesTheStateAFreshLoadWouldHave(t *testing.T) {
	t.Parallel()
	var l effect.Loader
	require.NoError(t, l.Apply(desired(
		entry("foo", nil),
		effect.Entry{
			ID:       "qux",
			Children: []effect.Entry{entry(valBar, map[string]string{"a": "1"})},
		},
	)))

	next := desired(
		effect.Entry{ID: "foo", Disabled: true},
		effect.Entry{ID: "qux", Children: []effect.Entry{
			entry("baz", nil),
			entry(valBar, map[string]string{"a": "2"}),
		}},
	)
	require.NoError(t, l.Apply(next))

	require.False(t, l.Active("foo"), "disabled → unloaded, and its effects reverted")
	require.True(t, l.Active("baz"), "newly declared → loaded")
	require.Equal(t, map[string]string{"a": "2"}, l.ConfigOf(valBar), "reconfigured in place")

	// …and the same configuration loaded from nothing lands in the same place (Thm 80).
	var fresh effect.Loader
	require.NoError(t, fresh.Apply(next))
	require.Equal(t, fresh.Snapshot(), l.Snapshot(),
		"Thm 80: whatever instantiations and retirements happened on the way, the system "+
			"quiesces where a load of the final configuration from scratch would have left it")
}

// ── Definition 81 — the binding runs in BOTH directions ────────────────────────────────────
//
// Koishi's `plugin update` test. A component that revises its own configuration has the change
// written back to its entry — and the sibling fields of that entry survive untouched.
//
// Without this, a block that reconfigures or disables itself is invisible on the owner's screen:
// the tool stops appearing and the panel still says it is on. That is the failure
// `block-failure-three-faces` was written against, arriving through a different door.

func TestComponentSelfUpdateIsWrittenBackToItsEntry(t *testing.T) {
	t.Parallel()
	var l effect.Loader
	require.NoError(t, l.Apply(desired(
		effect.Entry{ID: "qux", Children: []effect.Entry{
			{
				ID:        valBar,
				Config:    map[string]string{"a": "1"},
				Intercept: map[string]string{"when": "channel=789"},
			},
		}},
	)))

	require.NoError(t, l.SelfUpdate(valBar, map[string]string{"a": "3"}))

	require.Equal(t, map[string]string{"a": "3"}, l.Desired().Find(valBar).Config,
		"the component's own revision reached the declarative record the owner reads")
	require.Equal(t, map[string]string{"when": "channel=789"}, l.Desired().Find(valBar).Intercept,
		"and touched nothing else on the entry")
}

func TestComponentDisablingItselfShowsAsDisabled(t *testing.T) {
	t.Parallel()
	var l effect.Loader
	require.NoError(t, l.Apply(desired(entry("flaky", nil))))

	require.NoError(t, l.SelfDisable("flaky", "sandbox exited 1"))

	require.False(t, l.Active("flaky"))
	require.True(t, l.Desired().Find("flaky").Disabled,
		"a block that takes itself out of service is a disabled entry on the screen, not a tool "+
			"that silently stopped appearing")
	require.Equal(t, "sandbox exited 1", l.Desired().Find("flaky").DisabledReason,
		"and the owner is told why, by the block, in the block's words")
}

// ── Definition 81 — per-field dispatch, least disruptive operation ─────────────────────────
//
// The field that changed decides what happens. This is what lets a UI price an edit before the
// owner makes it, instead of treating every change as "restart and hope".

func TestEachFieldGetsTheLeastDisruptiveOperation(t *testing.T) {
	t.Parallel()
	var l effect.Loader
	require.NoError(t, l.Apply(desired(
		effect.Entry{
			ID:        valBar,
			Config:    map[string]string{"a": "1"},
			Intercept: map[string]string{"when": "x"},
		},
	)))
	gen := l.Generation(valBar)

	// intercept: "updated in place, and needs no reload".
	require.NoError(t, l.Apply(desired(
		effect.Entry{
			ID:        valBar,
			Config:    map[string]string{"a": "1"},
			Intercept: map[string]string{"when": "y"},
		},
	)))
	require.Equal(t, gen, l.Generation(valBar), "an intercept change must not reload the scope")

	// url/id: "rebuilds the entry, since its identity or its component has changed".
	require.NoError(t, l.Apply(desired(
		effect.Entry{
			ID:        valBar,
			URL:       "v2",
			Config:    map[string]string{"a": "1"},
			Intercept: map[string]string{"when": "y"},
		},
	)))
	require.NotEqual(t, gen, l.Generation(valBar), "a url change rebuilds")
}

// ── Theorem 70 — an entry whose coeffect is unmet waits, and does not error ────────────────
//
// The Lego property, and the reason the owner never has to sequence anything. Koishi's ecosystem is
// the demonstration: "a plugin whose dependency is unavailable stays inactive until it appears,
// without erroring."

func TestAnEntryWaitsForItsSeamInsteadOfFailing(t *testing.T) {
	t.Parallel()
	var l effect.Loader

	require.NoError(t, l.Apply(desired(
		effect.Entry{ID: "booker", Requires: []string{seamCalendar}},
	)), "declaring a block whose seam has no supplier is NOT an error")
	require.False(t, l.Active("booker"))
	require.Equal(t, effect.StateWaiting, l.State("booker"),
		"waiting on a coeffect is its own state — distinct from failed, which is what an owner "+
			"would otherwise be shown for a system that is working exactly as designed")

	require.NoError(t, l.Apply(desired(
		effect.Entry{ID: "booker", Requires: []string{seamCalendar}},
		effect.Entry{ID: "google-calendar", Provides: "calendar"},
	)))
	require.True(t, l.Active("booker"),
		"the supplier arriving activates the dependent on its own — no load order for anyone to "+
			"arrange (Thm 70)")

	// …and Corollary 69: taking the supplier away withdraws its contribution and leaves the
	// neighbours as they were.
	require.NoError(t, l.Apply(desired(
		effect.Entry{ID: "booker", Requires: []string{seamCalendar}},
		entry("unrelated", nil),
	)))
	require.Equal(t, effect.StateWaiting, l.State("booker"), "deactivated, not failed")
	require.True(t, l.Active("unrelated"), "Cor 69: a departing fiber leaves its neighbours alone")
}
