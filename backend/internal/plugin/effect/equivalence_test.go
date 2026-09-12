// equivalence_test.go —— §3.3.2: observational equivalence. Red by design.
//
// The relation every other file in this package reads its equalities up to. Worth its own tests
// because it is not a helper: §3.4.2 turns the choice of observations into a design lever that
// decides whether a seam's operations commute, and therefore whether Theorem 43 applies to it.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── Definition 33 — the part of the state no key binds is forgotten ────────────────────────────

func TestTwoTablesAgreeingAtTheDeclaredKeysAreEquivalentThoughTheRestDiffers(t *testing.T) {
	t.Parallel()

	var a, b effect.Table
	for _, tbl := range []*effect.Table{&a, &b} {
		_, err := tbl.Set(seamCalendar, "google")
		require.NoError(t, err)
	}
	_, err := a.Set("telemetry", "run-11")
	require.NoError(t, err)
	_, err = b.Set("telemetry", "run-12")
	require.NoError(t, err)

	require.True(t, a.Equivalent(&b, []string{seamCalendar}),
		"σ ≃_S σ' relates contexts AT A SET OF KEYS. A component declaring only `calendar` "+
			"cannot "+
			"tell these apart, and the relation says so")
	require.False(t, a.Equivalent(&b, []string{seamCalendar, "telemetry"}),
		"at a larger S it can, and the relation says that too — S is a parameter, not a "+
			"convenience")
}

// ── the paper's own example — a generative name is not restored, and recovery still holds ──────
//
// "A generative name is not restored by the inverse that discards it, since the next creation draws
// a fresh one." A `DeepEqual` here rejects a correct implementation, which is worse than accepting
// a wrong one, because someone will "fix" it by weakening the real property.

func TestAFreshGenerativeNameStillCountsAsRecovered(t *testing.T) {
	t.Parallel()

	var before, after effect.Table
	_, err := before.Set("block.schema", map[string]any{"name": "blk_a", "oid": 16411})
	require.NoError(t, err)
	// Dropped and re-provisioned: same schema, new OID. Nothing observable through the key's
	// operations distinguishes them.
	_, err = after.Set("block.schema", map[string]any{"name": "blk_a", "oid": 29887})
	require.NoError(t, err)

	nameOnly := []effect.Test{{func(v any) effect.Outcome {
		m, ok := v.(map[string]any)
		if !ok {
			return effect.Outcome{Defined: false}
		}
		return effect.Outcome{Value: m["name"], Defined: true}
	}}}
	require.True(t, effect.Indistinguishable(
		mustGet(t, &before, "block.schema"), mustGet(t, &after, "block.schema"), nameOnly),
		"Thm 7's equality 'is an idealization, because the physical state cannot be recovered as "+
			"it stood'. Reading it up to ≃ is what makes it a property an implementation can "+
			"actually have")
}

// ── Definition 31 — a test is a WORD, and one letter proves very little ────────────────────────
//
// The cases that separate two values are usually two operations deep. A relation checked with
// single calls will call a stateful seam and a stateless one equivalent.

func TestASingleOperationAgreesWhereATwoLetterWordSeparates(t *testing.T) {
	t.Parallel()

	// Two counters that read the same once and diverge on the second read.
	fresh := &counter{n: 0, step: 1}
	stuck := &counter{n: 0, step: 0}

	once := []effect.Test{{readCounter}}
	twice := []effect.Test{{readCounter, readCounter}}

	require.True(t, effect.Indistinguishable(fresh, stuck, once),
		"one letter is not a test in any interesting sense")
	require.False(t, effect.Indistinguishable(fresh, stuck, twice),
		"Def 31 quantifies over FINITE WORDS of operations, and this is why: 'provision then "+
			"read' and 'read then provision' are where two values part company")
}

// ── Definition 31 — undefined at both counts as agreement ──────────────────────────────────────

func TestAPreconditionFailingAtBothIsAgreementNotDisagreement(t *testing.T) {
	t.Parallel()

	var a, b effect.Table
	failing := []effect.Test{{func(v any) effect.Outcome { return effect.Outcome{Defined: false} }}}

	require.True(t, effect.Indistinguishable(&a, &b, failing),
		"'every test is defined at both or at neither and yields the same outcomes at both'. An "+
			"implementation that treated undefined as a mismatch would make every empty table "+
			"distinguishable from every other")
}

// ── Lemma 32 — an operation that does not respect ≈ is telling you to refine it ────────────────

func TestAnOperationThatFailsToRespectTheRelationMeansTheKeyPublishesMore(t *testing.T) {
	t.Parallel()

	fresh := &counter{n: 0, step: 1}
	stuck := &counter{n: 0, step: 0}
	once := []effect.Test{{readCounter}}

	require.False(t, effect.RespectedBy(readCounter, fresh, stuck, once),
		"≈ is the COARSEST equivalence every operation respects (Lemma 32.2). An operation that "+
			"does not respect the relation is not a bug in the test: the key publishes an "+
			"observation the relation has to be refined by, which is a fact about the seam's "+
			"contract")
}

// ── §3.4.2 — what a seam RETURNS decides whether its operations commute ────────────────────────
//
// The design lever, and the reason `Observers` is on the contract at all:
//
//	"An interface publishing fewer outcomes admits fewer tests and coarsens the relation, which
//	 can carry a key from one side of a division to the other."
//
// Two calendar seams, identical in what they do and different in what they say about it. The one
// that returns the provider's event id makes two bookings distinguishable, so its key is
// non-commutative and Theorem 43 does not apply — the effects must be reverted in order. The one
// that returns only success does not, and its effects may be reverted in any order.
//
// That is an API review question answered by a theorem instead of by taste.

func TestASeamReturningTheProvidersIdMakesItsKeyNonCommutative(t *testing.T) {
	t.Parallel()

	chatty := effect.Coeffect{
		Key:        "calendar",
		Operations: []string{"insert_event"}, // yields the created event's id
	}
	quiet := effect.Coeffect{
		Key:        "calendar",
		Operations: []string{"insert_event_void"}, // yields success, nothing more
	}

	// Two orders of the same pair of bookings.
	ab := &bookings{}
	ba := &bookings{}
	ab.insert("standup")
	ab.insert("retro")
	ba.insert("retro")
	ba.insert("standup")

	chattyTests := testsFrom(chatty.Observers())
	quietTests := testsFrom(quiet.Observers())

	require.False(t, effect.Indistinguishable(ab, ba, chattyTests),
		"the ids differ between the two orders, so the operations do not commute (Def 44) and "+
			"§3.4.2 says the order 'has to be imposed from outside the effects'")
	require.True(t, effect.Indistinguishable(ab, ba, quietTests),
		"publishing fewer outcomes coarsens ≈ and carries the key to the commutative side, where "+
			"Thm 43 lets its effects be reverted under any permutation. Same behaviour, "+
			"different guarantee, and the difference is the return type")
}

// ── the same claim, stated as the theorem it licenses ──────────────────────────────────────────

func TestTheCommutativityWitnessIsCheckedAgainstTheOperationsNotAsserted(t *testing.T) {
	t.Parallel()

	lying := effect.Coeffect{
		Key:         "calendar",
		Operations:  []string{"insert_event"},
		Commutative: true, // claimed
	}

	ab := &bookings{}
	ba := &bookings{}
	ab.insert("standup")
	ab.insert("retro")
	ba.insert("retro")
	ba.insert("standup")

	require.False(t, effect.Indistinguishable(ab, ba, testsFrom(lying.Observers())),
		"Def 46's witness is 'the provider's obligation', and an obligation nothing checks is a "+
			"comment. Thm 43's any-permutation recovery is built on this flag, so a false one "+
			"does not fail here — it fails later, as a teardown that leaves the wrong event "+
			"behind")
}

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────

type counter struct{ n, step int }

func readCounter(v any) effect.Outcome {
	c, ok := v.(*counter)
	if !ok {
		return effect.Outcome{Defined: false}
	}
	// Post-increment: the FIRST letter reports the state both counters share, and only the second
	// reports where they went. A pre-increment would separate them at letter one and make the
	// two-letter word prove nothing the one-letter word had not.
	was := c.n
	c.n += c.step
	return effect.Outcome{Value: was, Defined: true}
}

// bookings —— a calendar that assigns each insert a provider-side id.
type bookings struct {
	ids   map[string]int
	order []string
	next  int
}

func (b *bookings) insert(title string) {
	if b.ids == nil {
		b.ids = map[string]int{}
	}
	b.next++
	b.ids[title] = b.next
	b.order = append(b.order, title)
}

// testsFrom —— each published operation as a one-letter word, which is all an operation NAME
// can give. The point of the test is the difference between the two operation sets, not the depth.
func testsFrom(ops []effect.Op) []effect.Test {
	out := make([]effect.Test, 0, len(ops))
	for _, op := range ops {
		out = append(out, effect.Test{op})
	}
	return out
}

func mustGet(t *testing.T, tbl *effect.Table, k string) any {
	t.Helper()
	v, err := tbl.Get(k)
	require.NoError(t, err)
	return v
}
