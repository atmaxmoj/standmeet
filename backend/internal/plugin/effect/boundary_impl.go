// boundary_impl.go —— the implementation of §6.1's system boundary. Contract: boundary.go.
//
// Everything here is a DECLARATION, checked for consistency rather than inferred.
//
// That is forced by the section itself: whether the system can modify a location exclusively is a
// fact about the deployment, not about the code, and whether an operation can supply an inverse is
// a fact about the operation's implementation, not about its name. A `Reify` that guessed from the
// spelling of `insert_event` would be inventing a boundary rather than reading one — and the
// failure mode of getting it wrong is `Unload` reporting success over a world it did not restore.
//
// So the provider declares, the same way Definition 46 makes the commutativity witness "the
// provider's obligation", and this file's job is to refuse the combinations that cannot hold.

package effect

// Reify —— "a coeffect moves the boundary by reifying an external location: it confines every
// access to that location to a set of operations it provides, EACH OF WHICH IT CAN SUPPLY AN
// INVERSE FOR, so operations that acted as id_Γ come to be tracked in Γ and reverted."
//
// Two conditions, both read off the declarations:
//
//  1. the coeffects must actually cover the location — a set that names no key confines no
//     access;
//  2. every one of them must be `Revertible`, the provider's claim that its operations return their
//     own inverses in Definition 29's sense.
//
// A single generic operation is the case this refuses: exposing the medium is not confining access
// to it, and no bookkeeping wrapped around a raw `request` makes the calls through it revertible.
func Reify(loc Location, ops []Coeffect) Location {
	if len(ops) == 0 {
		return loc
	}
	for _, c := range ops {
		if !c.Revertible {
			return loc // the medium is still exposed: the boundary has not moved
		}
	}
	moved := loc
	moved.Side = Inside
	moved.Stage = Acquire
	if moved.Recovery == RecoveryCompensated {
		// What was recovered by compensation is now recovered by a real inverse.
		moved.Recovery = RecoveryNone
	}
	return moved
}

// Revertible —— whether an inverse registered here means anything.
//
// Only an Inside location: outside, "an operation on it acts as id_Γ and is therefore neither
// tracked nor reverted". Reporting otherwise would let `Unload` claim to have restored a world it
// never touched, which is worse than reporting the truth because it is invisible.
func (l Location) Revertible() bool {
	return l.Side == Inside
}

// Guaranteed —— whether §3.4's and §4.3's results apply to this location.
//
// False exactly for `RecoveryCompensated`, and §6.1's closing sentence is the reason:
//
//	"Such actions compose in the same LIFO order as inverses do, so the composition of §3.1
//	 transfers to them. THE METATHEORY DOES NOT: the commutation of Definition 65 is proved
//	 against ≃ and has to be re-established against the coarser one."
//
// So a compensating capability keeps Theorem 7's composition and loses Theorem 43's any-permutation
// revert and Theorem 80's confluence. Saying so here is cheaper than discovering it when two
// compensations that were assumed to commute did not.
func (l Location) Guaranteed() bool {
	if l.Side == Inside {
		return true // tracked in Γ: the results of §3.4 and §4.3 are about exactly this
	}
	// Outside, only a WITHHELD emission is covered, and covered vacuously: nothing crosses until
	// the state that produced it is certain, so there is no emission for the metatheory to be wrong
	// about. An emission that has already crossed is untracked whether it compensates or not.
	return l.Recovery == RecoveryWithheld
}
