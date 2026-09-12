// invoke.go — the verb dispatcher for supplier reach-back. #135 constrained-reachback: the
// **only** shape a sandboxed block uses to consume a supplier — `Invoke(seam, verb,
// argsJSON)`. The container only uses it **by name**: the host resolves the owner's active
// supplier by seam, dispatches by verb to the seam contract's typed method, and
// returns raw JSON. Consumers never get a typed proxy (unlike the old BookerDeps.Proxy, which
// stuffed the interface into deps).
//
// The typed CalendarProxy/MailProxy is demoted here to an internal supplier-layer detail: args
// are decoded into the contract's typed request, the result is encoded back to JSON, and both
// sides of the socket only ever see JSON. An unknown seam/verb → error (the caller folds
// this into a tool error).

package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// calVerb / mailVerb — dispatcher for a single verb (map dispatch, avoids the cyclomatic
// complexity of a big switch).
type calVerb func(
	ctx context.Context, cal CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

type mailVerb func(
	ctx context.Context, m MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

// Seam names each appear exactly once **inside this package**. Outside it
// (kernel / routing / composition root) they're passed only as strings.
const (
	seamCalendar = "calendar"
	seamMail     = "mail"
)

var calendarVerbs = map[string]calVerb{
	"connected":    calConnected,
	"free_busy":    calFreeBusy,
	"insert_event": calInsertEvent,
	"delete_event": calDeleteEvent,
}

var mailVerbs = map[string]mailVerb{
	"connected": mailConnected,
	"send":      mailSend,
}

// Invoke — resolve the active supplier by seam, dispatch by verb, return raw JSON. This is
// the backend for the reach-back gateway's `supplier.invoke` op.
func (s *Dispatcher) Invoke(
	ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	out, err := s.dispatchSeam(ctx, ownerID, seam, verb, args)
	if err != nil {
		// The failure is handed out **with its class attached**. The sandbox side of the
		// wire is cut off and can only branch on this code; without it, "owner never
		// configured this" and "configured but unreachable right now" become the same
		// sentence on the visitor's screen, and one of the two would be a lie (F-C-42). The
		// classification belongs here: the sentinels belong to this domain, and the thin
		// routing shell by design doesn't know them.
		return nil, &hostop.FaultError{Code: faultOf(err), Err: err}
	}
	return out, nil
}

// verbCanPerform — the **cross-seam** question: "can this owner's grant perform this one
// operation".
//
// Why it isn't put into calendarVerbs / mailVerbs: this question has nothing to do with
// seam, and it's answered not by a seam contract but by the grant on the connection row
// (`Dispatcher.CanPerform`). Copying it into each seam means the second seam eventually
// forgets to copy it (F-B-10).
const verbCanPerform = "can_perform"

func (s *Dispatcher) dispatchSeam(
	ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if verb == verbCanPerform {
		return s.canPerformVerb(ctx, ownerID, seam, args)
	}
	switch seam {
	case seamCalendar:
		return s.dispatchCalendarSeam(ctx, ownerID, verb, args)
	case seamMail:
		return s.dispatchMailSeam(ctx, ownerID, verb, args)
	default:
		return nil, fmt.Errorf("supplier invoke: unknown seam %q", seam)
	}
}

// dispatchCalendarSeam / dispatchMailSeam — resolve, then dispatch. One per seam because the
// resolve step is what differs; the rest is the same three lines, and inlining both into the
// switch above is what put that function over the branching budget.
func (s *Dispatcher) dispatchCalendarSeam(
	ctx context.Context, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	cal, err := s.calendarFor(ctx, ownerID)
	if err != nil {
		return unsuppliedAnswer(verb, err)
	}
	return dispatchCalendar(ctx, cal, ownerID, verb, args)
}

func (s *Dispatcher) dispatchMailSeam(
	ctx context.Context, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	m, err := s.mailFor(ctx, ownerID)
	if err != nil {
		return unsuppliedAnswer(verb, err)
	}
	return dispatchMail(ctx, m, ownerID, verb, args)
}

// verbConnected — the one verb that is a QUESTION rather than an action.
const verbConnected = "connected"

// unsuppliedAnswer — what a seam lookup failure means, which depends on what was asked.
//
// "Is mail connected?" has a true answer when nothing supplies mail: **no**. Every other
// verb is an action, and an action with no supplier is a failure. The old typed slots got
// this right by accident — `mailSlot.Connected` swallowed `errNoActiveSupplier` and
// returned false while `mailSlot.Send` propagated it — and the merge lost it, which turned
// "the owner has not connected mail yet" into a 500 on the approve endpoint. One place for
// both seams, so the second seam cannot drift from the first.
func unsuppliedAnswer(verb string, err error) (json.RawMessage, error) {
	if verb == verbConnected && errors.Is(err, ErrNoSupplier) {
		return marshalBool(verbConnected, false)
	}
	return nil, err
}

// faultOf — which class. **Only two classes**: "this path was never wired up" and "it's wired
// but can't do it right now" — because the downstream message built off this only ever has two
// forms. Saying it more precisely is a matter for the sentence, not the class.
func faultOf(err error) string {
	// ErrNoSupplier belongs here too: "no block supplies mail" is the owner never having
	// set this up — the same sentence the visitor needs. It is kept a distinct sentinel
	// (the owner's panel does tell installed-but-unauthorised apart from not-installed),
	// but on the visitor's side of the wire both collapse into "not configured".
	if errors.Is(err, ErrMailNotConfigured) ||
		errors.Is(err, ErrCalendarNotConnected) ||
		errors.Is(err, ErrNoSupplier) {
		return hostop.FaultNotConfigured
	}
	return hostop.FaultUnavailable
}

// InvokeByIDInput — everything needed to call a supplier directly by id (packed because the
// argument count exceeds the argument-limit).
type InvokeByIDInput struct {
	OwnerID string
	ID      string
	Seam    string
	Verb    string
	Args    json.RawMessage
}

// InvokeByID — run a seam verb by **block id** (bypassing the active slot).
//
// The only difference from Invoke is "who it targets": Invoke targets the seam's active
// slot, this targets the specified one directly. diag needs the latter — the owner just
// submitted a binding and wants it verified on its own merits, without interference from
// "which one is active".
//
// The output shape is identical to Invoke's (that same unified JSON), so the caller doesn't
// need to know a single seam type.
func (s *Dispatcher) InvokeByID(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	switch in.Seam {
	case seamCalendar:
		return s.byIDCalendar(ctx, in)
	case seamMail:
		return s.byIDMail(ctx, in)
	default:
		return nil, fmt.Errorf("supplier invoke: unknown seam %q", in.Seam)
	}
}

func (s *Dispatcher) byIDCalendar(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	cal, err := byIDAs[CalendarProxy](s, in)
	if err != nil {
		return nil, err
	}
	return dispatchCalendar(ctx, cal, in.OwnerID, in.Verb, in.Args)
}

func (s *Dispatcher) byIDMail(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	m, err := byIDAs[MailProxy](s, in)
	if err != nil {
		return nil, err
	}
	return dispatchMail(ctx, m, in.OwnerID, in.Verb, in.Args)
}

// byIDAs — resolve the NAMED block and assert it speaks the seam the caller asked for.
//
// This used to call the seam resolver and drop `in.ID` on the floor, so "invoke this
// block by id" ran against whichever block the owner had already activated. The owner
// uploads a binding, presses the button that exists to test THAT binding, and is told
// about a different block — or, when nothing is active yet, told the block is not
// found. Bypassing the active slot is the entire reason this path exists.
func byIDAs[T any](s *Dispatcher, in *InvokeByIDInput) (T, error) {
	var zero T
	if s == nil || s.byID == nil {
		return zero, fmt.Errorf("%w: %q (no by-id lookup wired)", ErrNotInstalled, in.ID)
	}
	sup, ok := s.byID(in.ID)
	if !ok {
		return zero, fmt.Errorf("%w: %q", ErrNotInstalled, in.ID)
	}
	typed, isSeam := sup.(T)
	if !isSeam {
		return zero, fmt.Errorf("%w: %q does not supply %q", ErrWrongSeam, in.ID, in.Seam)
	}
	return typed, nil
}

func dispatchCalendar(
	ctx context.Context, cal CalendarProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := calendarVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("supplier invoke: unknown calendar verb %q", verb)
	}
	return fn(ctx, cal, ownerID, args)
}

func dispatchMail(
	ctx context.Context, m MailProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := mailVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("supplier invoke: unknown mail verb %q", verb)
	}
	return fn(ctx, m, ownerID, args)
}

// canPerformVerb — `{"operation":"events.insert"}` → `{"can":true|false}`.
//
// What the sandbox side needs this for: a block may offer both **read** and **write**
// actions, while the owner's grant may cover only read. In that case the write tool is already
// gone from the tool table (F-B-8), but the **card** is still there (it's attached to the read
// tool), and every chip on it still says "tap to book" — an entry point into an action that
// can't be performed. With this question, the card can retract that entry point itself, the
// same way a booked card decides whether to render the confirmation-email widget based on
// `can_email`.
func (s *Dispatcher) canPerformVerb(
	ctx context.Context, ownerID, seam string, args json.RawMessage,
) (json.RawMessage, error) {
	var req struct {
		Operation string `json:"operation"`
	}
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("supplier invoke: decode can_perform args: %w", err)
	}
	if req.Operation == "" {
		return nil, errors.New("supplier invoke: can_perform needs an operation")
	}
	ok, err := s.CanPerform(ctx, ownerID, seam, req.Operation)
	if err != nil {
		return nil, fmt.Errorf("supplier can_perform: %w", err)
	}
	return marshalBool("can", ok)
}
