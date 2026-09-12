// names_test.go —— the seam keys and fiber names the property suite runs on.
//
// Named rather than spelled inline at each site, because the two kinds are easy to confuse when
// both are bare strings: `seamCalendar` is a KEY in Σ, and `fiberCal` is a NAME in the registry.
// Definition 50 insists names are atoms that no rule may read; keeping them in one list is the
// cheapest reminder that a test must not encode meaning into one either.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// Seam keys — the `k` of Σ, and what a component's Requires/Provides name.
const (
	seamCalendar = "calendar"
	seamMail     = "mail"
	seamIM       = "im"
	seamBooking  = "booking"
	seamSandbox  = "sandbox"
	seamStorage  = "storage"
)

// The toy world the §3 property tests write into: three keys and three values, so that an
// assertion names the PROPERTY it checks rather than the string that happened to be there.
const (
	keyAlpha = "alpha"
	keyA     = "a"
	keyB     = "b"
	keyC     = "c"
	valOne   = "1"
	valTwo   = "2"
	valThree = "3"
)

// implGoogleCal —— a supplier handle; the value bound at a seam, as against the seam's name.
const implGoogleCal = "google-calendar"

// Fiber names — the `n` of the registry. Atoms: nothing may parse one.
const (
	fiberCal    effect.Name = "cal"
	fiberMail   effect.Name = "mail"
	fiberIM     effect.Name = "im"
	fiberBooker effect.Name = "booker"
	fiberSlow   effect.Name = "slow"
	fiberA      effect.Name = "a"
	fiberB      effect.Name = "b"
	fiberC      effect.Name = "c"
)

// insert —— O-Insert at the root, which is what almost every test wants. Named because the
// `require.NoError(t, r.Insert(n, effect.Root, c))` it replaces appeared on nearly a hundred lines,
// and a test reads better as a list of what is in the registry than as a list of error checks.
func insert(t *testing.T, r *effect.Registry, n effect.Name, c effect.Component) {
	t.Helper()
	require.NoError(t, r.Insert(n, effect.Root, c))
}

// settle —— drive to quiescence, failing if the registry reports it could not.
//
// Distinct from `settleWithoutStalling` in teardown_test.go: this one trusts Settle's own error,
// which is right where the test is about something else. A test ABOUT the guard wants the stronger
// helper, because `Settle` alone cannot tell "quiet" from "gave up".
func settle(t *testing.T, r *effect.Registry) {
	t.Helper()
	require.NoError(t, r.Settle())
}

// retire —— O-Retire, which has one premise and therefore one failure mode: no such fiber.
func retire(t *testing.T, r *effect.Registry, n effect.Name) {
	t.Helper()
	require.NoError(t, r.Retire(n))
}

// drain —— apply lifecycle rules at ONE fiber until none applies, and report which fired.
//
// The rules it returns are the assertion in most callers: §4.3's theorems are claims about *which
// rule fires at whom*, so a test that only looked at the end state could not tell an L-Leave that
// stopped at the guard from an L-Unload that ran.
//
// Stopping at "no rule applies" is not the same as reaching quiescence: a fiber the guard holds has
// no rule available and the registry is still not quiet. That distinction is the point of every
// guard test, which is why this returns rather than looping until quiet.
func drain(r *effect.Registry, n effect.Name) []effect.Rule {
	var rules []effect.Rule
	for {
		rule, ok := r.StepAt(n)
		if !ok {
			return rules
		}
		rules = append(rules, rule)
	}
}

// stepAll —— drive the whole registry one rule at a time, returning the sequence taken.
//
// The nondeterminism is the registry's: "the relation commits to no order among them". This records
// whatever order it chose, so a test can compare two runs without prescribing one.
func stepAll(r *effect.Registry) []effect.Applied {
	var taken []effect.Applied
	for {
		step, ok := r.Step()
		if !ok {
			return taken
		}
		taken = append(taken, step)
	}
}
