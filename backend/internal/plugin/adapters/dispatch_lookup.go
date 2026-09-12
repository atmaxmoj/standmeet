// dispatch_lookup.go — how the dispatcher gets from a seam name to something it can
// call.
//
// This is where the typed surface actually died. `Slots` used to expose one accessor
// per seam — `Calendar() contract.CalendarProxy`, `Mail() contract.MailProxy`, plus
// `SupplierCalendar(id)` / `SupplierMail(id)` — so a new seam cost a proxy
// interface, an accessor, a slot adapter and a case in every switch. That is the star
// topology written in Go types, and `backend-domain-modules.md` named
// `contract.CalendarProxy` as the thing to delete.
//
// What replaces it: one lookup by NAME, then one type assertion at the point of use.
// The assertion has not vanished — a calendar call still needs something with
// calendar methods — but it happens once, in the dispatcher, instead of being the
// mechanism by which suppliers are found. Adding a seam now costs a case here and
// nothing anywhere else.

package adapters

import (
	"context"
	"errors"
	"fmt"
)

// ErrNoSupplier — nothing supplies this seam for this owner.
//
// Distinct from "the supplier is there but not connected", which the supplier itself
// answers. Collapsing the two is how an owner ends up staring at a tool that fails
// with no way to tell whether he forgot to install something or forgot to authorise
// it.
var ErrNoSupplier = errors.New("no block supplies this seam")

// ErrWrongSeam — the named block exists but does not speak this seam.
var ErrWrongSeam = errors.New("block does not supply the requested seam")

// calendarFor — the owner's active calendar supplier, as a calendar.
func (s *Dispatcher) calendarFor(ctx context.Context, ownerID string) (CalendarProxy, error) {
	return seamAs[CalendarProxy](ctx, s, ownerID, seamCalendar)
}

// mailFor — the owner's active mail supplier, as a mailer.
func (s *Dispatcher) mailFor(ctx context.Context, ownerID string) (MailProxy, error) {
	return seamAs[MailProxy](ctx, s, ownerID, seamMail)
}

// CanPerformer — a supplier that can answer "may this owner's grant do this one
// operation".
//
// Optional, and declared by implementing it. An openapi supplier can answer (it
// compares the spec's per-operation scope against the scope on the connection row); a
// protocol supplier has no notion of scope and does not implement it.
type CanPerformer interface {
	CanPerform(ctx context.Context, ownerID, operationID string) (bool, error)
}

// CanPerform — whether this owner's supplier for a seam may do one operation (F-B-8).
//
// Allow when the supplier cannot answer, which is the opposite of the rule for "not
// connected" and deliberately so. A protocol supplier has no scopes, and reading
// "can't answer" as "can't do it" would hide a whole class of working tools. The
// question being asked here is narrow: the owner granted calendar.readonly, so
// listing slots must keep working while booking must always fail — a block-level
// answer cannot express that, which is why this exists at all.
func (s *Dispatcher) CanPerform(
	ctx context.Context, ownerID, seam, operationID string,
) (bool, error) {
	if s == nil || s.lookup == nil {
		return true, nil
	}
	sup, err := s.lookup(ctx, ownerID, seam)
	if err != nil {
		return false, err
	}
	if sup == nil {
		// Nothing supplies the seam, so it certainly cannot perform the operation —
		// and that is an answer, not a failure. The block-level gate already refuses
		// the tool; surfacing an error here would turn "not connected" into a 500 on
		// a question the caller asked precisely to avoid one.
		return false, nil
	}
	return askCanPerform(ctx, sup, ownerID, operationID)
}

// askCanPerform — put the question to a resolved supplier, if it is the kind that can answer.
func askCanPerform(
	ctx context.Context, sup Supplier, ownerID, operationID string,
) (bool, error) {
	asker, ok := sup.(CanPerformer)
	if !ok {
		return true, nil
	}
	can, err := asker.CanPerform(ctx, ownerID, operationID)
	if err != nil {
		return false, fmt.Errorf("supplier can-perform %q: %w", operationID, err)
	}
	return can, nil
}

// seamAs — resolve a seam by name and assert it speaks the shape the caller needs.
//
// Generic because the two seams differ only in that shape; writing it twice is how
// the third one ends up subtly different from the first two, which is exactly what
// happened to policy evaluation and slot enumeration when calendar was implemented
// once for the host and once for the sandbox.
func seamAs[T any](
	ctx context.Context, s *Dispatcher, ownerID, seam string,
) (T, error) {
	var zero T
	sup, err := resolveSeam(ctx, s, ownerID, seam)
	if err != nil {
		return zero, err
	}
	typed, ok := sup.(T)
	if !ok {
		return zero, fmt.Errorf("%w: %q supplies %q", ErrWrongSeam, sup.Name(), seam)
	}
	return typed, nil
}

// resolveSeam — the owner's active supplier for a seam, or an ErrNoSupplier that says which
// of the two ways it is missing: nothing wired at all, or nothing chosen for this seam.
func resolveSeam(
	ctx context.Context, s *Dispatcher, ownerID, seam string,
) (Supplier, error) {
	if s == nil || s.lookup == nil {
		return nil, fmt.Errorf("%w: %q (no lookup wired)", ErrNoSupplier, seam)
	}
	sup, err := s.lookup(ctx, ownerID, seam)
	if err != nil {
		return nil, err
	}
	if sup == nil {
		return nil, fmt.Errorf("%w: %q", ErrNoSupplier, seam)
	}
	return sup, nil
}
