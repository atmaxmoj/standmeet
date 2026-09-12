// boundary.go —— §6.1: the system boundary, and what an inverse is worth on each side of it.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.
//
// # The division
//
// Every effect in §3.1 carries an inverse, and "what that inverse amounts to is settled by the
// system boundary", which divides the environment in two:
//
//  1. A location lies **inside** when the system "is able to modify it exclusively and to restore
//     the state before that modification, so an operation on it is tracked in Γ and can be
//     reverted".
//  2. A location lies **outside** when either ability fails, "so an operation on it acts as id_Γ
//     and is therefore neither tracked nor reverted".
//
// Two abilities, and losing either one is enough. A postgres schema this instance alone writes is
// inside. The same schema with a second writer is outside — not because the medium changed, but
// because exclusivity did. "The boundary is drawn per location rather than per medium."
//
// # Acquisition and emission — the part that decides product behaviour
//
// An operation reaching outside "generally proceeds in two stages", and they land on opposite
// sides:
//
//   - **Acquisition** obtains access and installs a record inside the boundary — "open installs a
//     descriptor that close removes, malloc reserves a block that free releases, fork starts a
//     child process that kill terminates". Installing that record is a revertible effect.
//   - **Emission** pushes data through that channel — "the bytes a write hands to the file or the
//     datagram a send puts on the wire" — and "the push acts as id_Γ, leaving the data where
//     other parties may read and write it".
//
// So for every outward capability in this codebase there are two things, and only the first is
// revertible. An SMTP connection is an acquisition; the message is an emission. A calendar client
// is an acquisition; the invitation that lands in someone's inbox is an emission. Unloading the
// mail supplier closes the connection and does not unsend the mail, and no amount of care with
// disposers changes that — it is a fact about where the boundary is.
//
// # The two ways to recover from an emission, and the one this repo already uses
//
// "A system that must nonetheless recover from an emission has two approaches available."
//
//   - **Withholding**: hold the emission back "until the state that produced it is certain to
//     persist, which is the output commit problem of rollback-recovery".
//   - **Compensation**: an action restoring the state "up to an equivalence the application
//     supplies, coarser than the ≃ of Definition 33, as in deleting a file that was created or
//     refunding a charge that was made".
//
// **The job loop is withholding, and nobody had a name for it.** `resume.draft` renders a PDF to
// staging, the owner looks at it, and only `applications.commit` issues the code and sends. The
// design note for that says "点头才发"; §6.1 says it is the output commit problem, and that
// the alternative — emit and compensate — would mean retracting an application, which has no
// inverse anyone would accept.
//
// The compensations are the other half: `codes.revoke` compensates an issued access code, and
// `writings.unpublish` compensates a publication. Neither restores the world — a recruiter who
// already read the page read it — which is exactly what "coarser than ≃" means.
//
// And the sting in the tail, which is why this file exists at all rather than being a paragraph:
//
//	"Such actions compose in the same LIFO order as inverses do, so the composition of §3.1
//	 transfers to them. THE METATHEORY DOES NOT: the commutation of Definition 65 is proved
//	 against ≃ and has to be re-established against the coarser one."
//
// Compensations compose, but Theorems 43, 68 and 80 do not carry over to them for free. A
// capability that recovers by compensating is outside the guarantees the rest of this package
// proves, and saying so in the type is better than discovering it when two compensations that were
// assumed to commute did not.

package effect

// Side —— which side of the boundary a location lies on.
type Side string

const (
	// Inside —— exclusively modifiable and restorable. Tracked in Γ, revertible.
	Inside Side = "inside"

	// Outside —— one of the two abilities fails. Acts as id_Γ: neither tracked nor reverted.
	Outside Side = "outside"
)

// Recovery —— how a capability proposes to recover from what it emits.
type Recovery string

const (
	// RecoveryNone —— nothing outside the boundary is emitted, so there is nothing to recover.
	// The strongest claim, and available to more capabilities than people assume.
	RecoveryNone Recovery = "none"

	// RecoveryWithheld —— the output commit problem: nothing crosses until the state that
	// produced it is certain. The job loop's draft/commit split.
	RecoveryWithheld Recovery = "withheld"

	// RecoveryCompensated —— an action restoring the state up to an equivalence the application
	// supplies, coarser than ≃. `codes.revoke`, `writings.unpublish`.
	//
	// **Declaring this forfeits the metatheory.** §6.1: the commutation of Definition 65 "has to
	// be re-established against the coarser one". Theorem 43's any-permutation revert and Theorem
	// 80's confluence are proved at ≃ and do not transfer.
	RecoveryCompensated Recovery = "compensated"
)

// Location —— one place a capability touches, classified.
//
// The classification is a declaration by whoever wrote the capability, not something this package
// can infer: whether the system writes a location exclusively is a fact about the deployment. What
// the package does with the declaration is refuse to pretend — an `Outside` location's operations
// are not counted as revertible, and `Unload` does not claim to have restored one.
type Location struct {
	Name     string
	Side     Side
	Stage    Stage
	Recovery Recovery
}

// Stage —— acquisition or emission, per §6.1's two-stage reading of an outward operation.
type Stage string

const (
	// Acquire —— installs a record inside the boundary: the descriptor, the connection, the
	// child process. Revertible, and "that record is at the same time the channel along which data
	// can leave".
	Acquire Stage = "acquire"

	// Emit —— pushes data through the channel. Crosses the boundary; acts as id_Γ.
	Emit Stage = "emit"
)

// Reify —— "a coeffect moves the boundary by reifying an external location: it confines every
// access to that location to a set of operations it provides, each of which it can supply an
// inverse for, so operations that acted as id_Γ come to be tracked in Γ and reverted."
//
// This is the mechanism by which a seam *earns* revertibility for something that did not have it. A
// calendar seam whose `insert_event` yields the delete that undoes it has moved a booking inside
// the boundary; one that exposes raw HTTP has not, and no wrapper around it can, because the set of
// operations is the thing doing the work.
//
// "Moving the boundary is itself a trade-off, between whether the environment provides revertible
// semantics for a location and what supplying those semantics costs on every access."
//
// The trade-off is the design question every seam poses.

// Revertible —— whether an operation at this location is tracked and can be reverted, i.e.
// whether an inverse registered for it means anything.
//
// The method exists so that a `Dispose` registered against an `Outside` emission can be refused
// rather than accepted and silently not honoured. A disposer that cannot undo what it names is
// worse than none: it makes `Unload` report success over a world it did not restore, and Theorem 7
// is then false while every test of it passes.

// Guaranteed —— whether the results of §3.4 and §4.3 apply to this location.
//
// False for `RecoveryCompensated`, per §6.1's closing sentence. A capability that compensates
// still composes in LIFO, but independence, any-permutation recovery and confluence have to be
// re-established against the application's coarser equivalence, and this package has not done that.
