// boundary_test.go —— §6.1: the system boundary. Red by design.
//
// The locations below are this instance's real ones, because the whole value of the section is that
// it settles arguments about specific capabilities. "Can we undo sending the application email" is
// not a question about how careful the disposer is.

package effect_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// ── the two-stage split — an outward capability is two locations, not one ──────────────────────

func TestAcquisitionIsRevertibleAndTheEmissionThroughItIsNot(t *testing.T) {
	t.Parallel()

	conn := effect.Location{
		Name: "smtp.connection", Side: effect.Inside,
		Stage: effect.Acquire, Recovery: effect.RecoveryNone,
	}
	message := effect.Location{
		Name: "smtp.message", Side: effect.Outside,
		Stage: effect.Emit, Recovery: effect.RecoveryCompensated,
	}

	require.True(t, conn.Revertible(),
		"§6.1: the acquisition 'installs a record inside the boundary' — open/close, "+
			"malloc/free, fork/kill. Closing the connection is a real inverse")
	require.False(t, message.Revertible(),
		"the emission 'acts as id_Γ, leaving the data where other parties may read and write "+
			"it'. Unloading the mail supplier closes the connection; it does not unsend the mail, "+
			"and no disposer can be written that does")
}

// ── the refusal that matters — a disposer over an emission would make Theorem 7 a lie ──────────
//
// Not a style rule. An inverse accepted over an `Outside` location makes `Unload` report success
// over a world it did not restore, so the soundness invariant is false while every test asserting
// it passes — the worst of the two failure modes, because it is invisible.

func TestAnInverseOverAnEmissionIsRefusedRatherThanQuietlyNotHonoured(t *testing.T) {
	t.Parallel()

	post := effect.Location{
		Name: "webhook.post", Side: effect.Outside,
		Stage: effect.Emit, Recovery: effect.RecoveryNone,
	}
	require.False(t, post.Revertible())
	require.False(t, post.Guaranteed(),
		"an emission claiming RecoveryNone recovers from nothing; the claim is that there IS no "+
			"recovery, which is honest and still leaves the location outside the guarantees")
}

// ── reification moves the boundary, and what moves it is the operation set ─────────────────────
//
// "A coeffect moves the boundary by reifying an external location: it confines every access to that
// location to a set of operations it provides, each of which it can supply an inverse for."
//
// The consequence is a design rule for seams that is otherwise a matter of taste: a seam earns
// revertibility by *narrowing* what it exposes. One that hands out raw HTTP cannot, however much
// bookkeeping is wrapped around it, because the set of operations is what does the work.

func TestASeamEarnsRevertibilityByConfiningAccessToOperationsItCanInvert(t *testing.T) {
	t.Parallel()

	remote := effect.Location{
		Name: "calendar.remote", Side: effect.Outside,
		Stage: effect.Emit, Recovery: effect.RecoveryNone,
	}

	// A seam publishing an operation set in which every member has an inverse.
	confined := effect.Reify(remote, []effect.Coeffect{{
		Key:         "calendar",
		Operations:  []string{"insert_event", "delete_event"},
		Commutative: false,
		Revertible:  true, // the provider's claim: each operation yields its own inverse (Def 29)
	}})
	require.Equal(t, effect.Inside, confined.Side,
		"operations that acted as id_Γ 'come to be tracked in Γ and reverted' — a booking "+
			"became "+
			"revertible because the seam supplied the delete that undoes it")
	require.True(t, confined.Revertible())

	// A seam that exposes the medium instead of a set of operations moves nothing.
	passthrough := effect.Reify(remote, []effect.Coeffect{{
		Key:        "calendar",
		Operations: []string{"request"},
		// No claim, and none could be made: a generic `request` exposes the medium instead of
		// confining access to it, and "whatever you asked for" has no inverse.
	}})
	require.Equal(t, effect.Outside, passthrough.Side,
		"'the boundary is drawn per location rather than per medium' — a generic `request` is "+
			"not "+
			"an operation an inverse can be supplied for, so nothing was reified")
}

// ── withholding vs compensation, and the price of the second ───────────────────────────────────
//
// The job loop is withholding: `resume.draft` renders to staging, the owner looks, and only
// `applications.commit` issues the code and sends. §6.1 names that the output commit problem.

func TestWithholdingKeepsTheGuaranteesAndCompensatingForfeitsThem(t *testing.T) {
	t.Parallel()

	draft := effect.Location{
		Name: "application.submit", Side: effect.Outside,
		Stage: effect.Emit, Recovery: effect.RecoveryWithheld,
	}
	revoke := effect.Location{
		Name: "access_code.issue", Side: effect.Outside,
		Stage: effect.Emit, Recovery: effect.RecoveryCompensated,
	}

	require.True(t, draft.Guaranteed(),
		"nothing crossed the boundary before the state that produced it was certain, so there is "+
			"no emission for the metatheory to be wrong about")

	require.False(t, revoke.Guaranteed(),
		"§6.1's last sentence: compensations 'compose in the same LIFO order as inverses do, so "+
			"the composition of §3.1 transfers to them. THE METATHEORY DOES NOT: the commutation "+
			"of Definition 65 is proved against ≃ and has to be re-established against the "+
			"coarser one.' Revoking a code does not unread the page, so Thm 43's "+
			"any-permutation revert and Thm 80's confluence are not available here and must not "+
			"be assumed by anything built on top")
}

// ── the boundary is a property of the deployment, not of the medium ────────────────────────────

func TestTheSameMediumFallsOnBothSidesDependingOnWhoElseWritesIt(t *testing.T) {
	t.Parallel()

	// A block's own schema, which this instance alone writes.
	private := effect.Location{
		Name: "postgres.block_schema", Side: effect.Inside,
		Stage: effect.Acquire, Recovery: effect.RecoveryNone,
	}
	// The same medium, shared with another writer.
	shared := effect.Location{
		Name: "postgres.shared_table", Side: effect.Outside,
		Stage: effect.Emit, Recovery: effect.RecoveryCompensated,
	}

	require.True(t, private.Revertible())
	require.False(t, shared.Revertible(),
		"'a memory region lies inside when the system alone writes it, and outside when other "+
			"processes write it too'. Exclusivity is one of the two abilities, and losing either "+
			"is enough — so `DROP SCHEMA` is an inverse and a DELETE against a shared table is "+
			"not")
}
