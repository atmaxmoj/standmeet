// danger.go —— how much an operation can hurt, declared with the operation (refactor ledger R8).
//
// Parity makes every op whose Reach targets a face appear there — which kills silent omission and,
// by the same move, publishes a dangerous op on a long-lived-key face the day it is added
// (backend-domain-modules.md, "a generated fan-out makes omission impossible — and mis-exposure
// easy"). The cure is not a second exposure list; it is one more fact on the op: its blast radius.
// A face that carries long-lived keys (the owner MCP) then admits an op only to keys scoped for its
// class (R7). Read and query ops are DangerRead by their Kind; an action must say which class it
// is, and the dispatcher's boot check refuses one that does not (no default to "publish").

package facadeparity

import "slices"

// Danger —— an operation's blast radius. Ordered from harmless to grave only for display; scopes
// are sets, not thresholds.
type Danger string

// The classes (backend-domain-modules.md lists the inventory that produced them).
const (
	// DangerRead —— reads; changes nothing. Implied by Kind Read / Query.
	DangerRead Danger = "read"
	// DangerWrite —— creates or edits the owner's content and settings; undoable by another edit.
	DangerWrite Danger = "write"
	// DangerDestructive —— deletes or revokes; not undoable (corpus.delete, codes.revoke).
	DangerDestructive Danger = "destructive"
	// DangerCredential —— mints, stores, rotates or reveals a secret (keys, provider tokens).
	DangerCredential Danger = "credential"
	// DangerAuthority —— changes who can reach what (codes, roles, denials, handle, domains, the
	// public API, installs, the instance's own upgrade).
	DangerAuthority Danger = "authority"
	// DangerSpend —— runs something that costs money or quota on the owner's behalf.
	DangerSpend Danger = "spend"
	// DangerEgress —— sends the owner's data somewhere else (outbound webhooks, mail).
	DangerEgress Danger = "egress"
)

// AllDangers —— every class, in display order: the "full" scope.
func AllDangers() []Danger {
	return []Danger{
		DangerRead, DangerWrite, DangerDestructive, DangerCredential,
		DangerAuthority, DangerSpend, DangerEgress,
	}
}

// ValidDanger —— a class this vocabulary knows.
func ValidDanger(d Danger) bool {
	return slices.Contains(AllDangers(), d)
}

// DangerOf —— an op's class: Read / Query are DangerRead; an action is what it declared ("" when it
// declared nothing — the boot check's red).
func (o *Op) DangerOf() Danger {
	if o.Kind != Action {
		return DangerRead
	}
	return o.Danger
}
