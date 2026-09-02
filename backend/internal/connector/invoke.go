// invoke.go — the verb dispatcher for connector reach-back. #135 constrained-reachback: the
// **only** shape a sandboxed capability uses to consume a connector — `Invoke(category, verb,
// argsJSON)`. The container only uses it **by name**: the host resolves the owner's active
// connector by category, dispatches by verb to the category contract's typed method, and
// returns raw JSON. Consumers never get a typed proxy (unlike the old BookerDeps.Proxy, which
// stuffed the interface into deps).
//
// The typed CalendarProxy/MailProxy is demoted here to an internal connector-layer detail: args
// are decoded into the contract's typed request, the result is encoded back to JSON, and both
// sides of the socket only ever see JSON. An unknown category/verb → error (the caller folds
// this into a tool error).

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// calVerb / mailVerb — dispatcher for a single verb (map dispatch, avoids the cyclomatic
// complexity of a big switch).
type calVerb func(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

type mailVerb func(
	ctx context.Context, m contract.MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

// Category names each appear exactly once **inside the connector axis**. Outside the axis
// (kernel / routing / composition root) they're passed only as strings.
const (
	categoryCalendar = "calendar"
	categoryMail     = "mail"
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

// Invoke — resolve the active connector by category, dispatch by verb, return raw JSON. This is
// the backend for the reach-back gateway's `connector.invoke` op.
func (s *Slots) Invoke(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	out, err := s.dispatchCategory(ctx, ownerID, category, verb, args)
	if err != nil {
		// The failure is handed out **with its category attached**. The sandbox side of the
		// wire is cut off and can only branch on this code; without it, "owner never
		// configured this" and "configured but unreachable right now" become the same
		// sentence on the visitor's screen, and one of the two would be a lie (F-C-42). The
		// classification belongs here: the sentinels belong to this domain, and the thin
		// routing shell by design doesn't know them.
		return nil, &hostop.FaultError{Code: faultOf(err), Err: err}
	}
	return out, nil
}

// verbCanPerform — the **cross-category** question: "can this owner's grant perform this one
// operation".
//
// Why it isn't put into calendarVerbs / mailVerbs: this question has nothing to do with
// category, and it's answered not by a category contract but by the grant on the connection row
// (`Slots.CanPerform`). Copying it into each category means the second category eventually
// forgets to copy it (F-B-10).
const verbCanPerform = "can_perform"

func (s *Slots) dispatchCategory(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if verb == verbCanPerform {
		return s.canPerformVerb(ctx, ownerID, category, args)
	}
	switch category {
	case categoryCalendar:
		return dispatchCalendar(ctx, s.Calendar(), ownerID, verb, args)
	case categoryMail:
		return dispatchMail(ctx, s.Mail(), ownerID, verb, args)
	default:
		return nil, fmt.Errorf("connector invoke: unknown category %q", category)
	}
}

// faultOf — which class. **Only two classes**: "this path was never wired up" and "it's wired
// but can't do it right now" — because the downstream message built off this only ever has two
// forms. Saying it more precisely is a matter for the sentence, not the class.
func faultOf(err error) string {
	if errors.Is(err, consumer.ErrMailNotConfigured) ||
		errors.Is(err, contract.ErrCalendarNotConnected) {
		return hostop.FaultNotConfigured
	}
	return hostop.FaultUnavailable
}

// InvokeByIDInput — everything needed to call a connector directly by id (packed because the
// argument count exceeds the argument-limit).
type InvokeByIDInput struct {
	OwnerID  string
	ID       string
	Category string
	Verb     string
	Args     json.RawMessage
}

// InvokeByID — run a category verb by **connector id** (bypassing the active slot).
//
// The only difference from Invoke is "who it targets": Invoke targets the category's active
// slot, this targets the specified one directly. diag needs the latter — the owner just
// submitted a binding and wants it verified on its own merits, without interference from
// "which one is active".
//
// The output shape is identical to Invoke's (that same unified JSON), so the caller doesn't
// need to know a single category type.
func (s *Slots) InvokeByID(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	switch in.Category {
	case categoryCalendar:
		return s.byIDCalendar(ctx, in)
	case categoryMail:
		return s.byIDMail(ctx, in)
	default:
		return nil, fmt.Errorf("connector invoke: unknown category %q", in.Category)
	}
}

func (s *Slots) byIDCalendar(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	cal, ok := s.ConnectorCalendar(in.ID)
	if !ok {
		return nil, fmt.Errorf("%w: %q is not a %s connector", ErrNotFound, in.ID, in.Category)
	}
	return dispatchCalendar(ctx, cal, in.OwnerID, in.Verb, in.Args)
}

func (s *Slots) byIDMail(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	m, ok := s.ConnectorMail(in.ID)
	if !ok {
		return nil, fmt.Errorf("%w: %q is not a %s connector", ErrNotFound, in.ID, in.Category)
	}
	return dispatchMail(ctx, m, in.OwnerID, in.Verb, in.Args)
}

func dispatchCalendar(
	ctx context.Context, cal contract.CalendarProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := calendarVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("connector invoke: unknown calendar verb %q", verb)
	}
	return fn(ctx, cal, ownerID, args)
}

func dispatchMail(
	ctx context.Context, m contract.MailProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := mailVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("connector invoke: unknown mail verb %q", verb)
	}
	return fn(ctx, m, ownerID, args)
}

// canPerformVerb — `{"operation":"events.insert"}` → `{"can":true|false}`.
//
// What the sandbox side needs this for: a capability may offer both **read** and **write**
// actions, while the owner's grant may cover only read. In that case the write tool is already
// gone from the tool table (F-B-8), but the **card** is still there (it's attached to the read
// tool), and every chip on it still says "tap to book" — an entry point into an action that
// can't be performed. With this question, the card can retract that entry point itself, the
// same way a booked card decides whether to render the confirmation-email widget based on
// `can_email`.
func (s *Slots) canPerformVerb(
	ctx context.Context, ownerID, category string, args json.RawMessage,
) (json.RawMessage, error) {
	var req struct {
		Operation string `json:"operation"`
	}
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode can_perform args: %w", err)
	}
	if req.Operation == "" {
		return nil, errors.New("connector invoke: can_perform needs an operation")
	}
	ok, err := s.CanPerform(ctx, ownerID, category, req.Operation)
	if err != nil {
		return nil, fmt.Errorf("connector can_perform: %w", err)
	}
	return marshalBool("can", ok)
}

// ─── calendar verbs ───

func calConnected(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := cal.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("calendar connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func calFreeBusy(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req contract.FreeBusyReq
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode free_busy args: %w", err)
	}
	out, err := cal.FreeBusy(ctx, ownerID, req)
	if err != nil {
		return nil, fmt.Errorf("calendar free_busy: %w", err)
	}
	b, merr := json.Marshal(out)
	if merr != nil {
		return nil, fmt.Errorf("connector invoke: marshal free_busy: %w", merr)
	}
	return b, nil
}

func calInsertEvent(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req contract.InsertEventReq
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode insert_event args: %w", err)
	}
	out, err := cal.InsertEvent(ctx, ownerID, &req)
	if err != nil {
		return nil, fmt.Errorf("calendar insert_event: %w", err)
	}
	b, merr := json.Marshal(out)
	if merr != nil {
		return nil, fmt.Errorf("connector invoke: marshal insert_event: %w", merr)
	}
	return b, nil
}

// delEventArgs — the input shape for delete_event (the category contract has no typed request
// for it, just these two strings).
type delEventArgs struct {
	EventID       string `json:"event_id"`
	AttendeeEmail string `json:"attendee_email"`
}

func calDeleteEvent(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req delEventArgs
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode delete_event args: %w", err)
	}
	if err := cal.DeleteEvent(ctx, ownerID, req.EventID, req.AttendeeEmail); err != nil {
		return nil, fmt.Errorf("calendar delete_event: %w", err)
	}
	return marshalBool("ok", true)
}

// ─── mail verbs ───

func mailConnected(
	ctx context.Context, m contract.MailProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := m.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func mailSend(
	ctx context.Context, m contract.MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var msg contract.MailMessage
	if err := json.Unmarshal(args, &msg); err != nil {
		return nil, fmt.Errorf("connector invoke: decode send args: %w", err)
	}
	rcpt, err := m.Send(ctx, ownerID, msg)
	if err != nil {
		return nil, fmt.Errorf("mail send: %w", err)
	}
	// The receipt carries the id the provider gave (F-C-55). Empty = this path (SMTP) can't
	// produce one, not a failure.
	return marshalSendReceipt(rcpt.ProviderID)
}

// marshalSendReceipt — `{"ok":true,"provider_id":"…"}`. Like its neighboring marshal helpers,
// takes a concrete type and wraps errors in place (wrapcheck requires an external package's
// error to be wrapped once within this package).
func marshalSendReceipt(providerID string) (json.RawMessage, error) {
	b, err := json.Marshal(struct {
		ProviderID string `json:"provider_id,omitempty"`
		OK         bool   `json:"ok"`
	}{ProviderID: providerID, OK: true})
	if err != nil {
		return nil, fmt.Errorf("connector invoke: marshal send receipt: %w", err)
	}
	return b, nil
}

// ─── marshal helpers (all take concrete types, never touch the forbidigo-banned any) ───

func marshalBool(key string, v bool) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]bool{key: v})
	if err != nil {
		return nil, fmt.Errorf("connector invoke: marshal %s: %w", key, err)
	}
	return b, nil
}
