// invoke_verbs.go — one function per verb on a seam contract, plus the marshal helpers.
//
// Split out of invoke.go, which had passed the max-lines ceiling, and along a real seam
// rather than wherever the lines ran out: that file answers "how does a seam+verb find the
// active supplier", this one answers "what does one verb actually do". Adding a verb to a
// seam touches only this file and the map that names it.
//
// Every function here has the same shape on purpose: decode the args into the seam
// contract's typed request, call the typed method, encode the result back to JSON. Both
// sides of the socket only ever see JSON; the typed proxy never leaves this package.

package adapters

import (
	"context"
	"encoding/json"
	"fmt"
)

// ─── calendar verbs ───

func calConnected(
	ctx context.Context, cal CalendarProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := cal.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("calendar connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func calFreeBusy(
	ctx context.Context, cal CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req FreeBusyReq
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("supplier invoke: decode free_busy args: %w", err)
	}
	out, err := cal.FreeBusy(ctx, ownerID, req)
	if err != nil {
		return nil, fmt.Errorf("calendar free_busy: %w", err)
	}
	b, merr := json.Marshal(out)
	if merr != nil {
		return nil, fmt.Errorf("supplier invoke: marshal free_busy: %w", merr)
	}
	return b, nil
}

func calInsertEvent(
	ctx context.Context, cal CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req InsertEventReq
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("supplier invoke: decode insert_event args: %w", err)
	}
	out, err := cal.InsertEvent(ctx, ownerID, &req)
	if err != nil {
		return nil, fmt.Errorf("calendar insert_event: %w", err)
	}
	b, merr := json.Marshal(out)
	if merr != nil {
		return nil, fmt.Errorf("supplier invoke: marshal insert_event: %w", merr)
	}
	return b, nil
}

// delEventArgs — the input shape for delete_event (the seam contract has no typed request
// for it, just these two strings).
type delEventArgs struct {
	EventID       string `json:"event_id"`
	AttendeeEmail string `json:"attendee_email"`
}

func calDeleteEvent(
	ctx context.Context, cal CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req delEventArgs
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("supplier invoke: decode delete_event args: %w", err)
	}
	if err := cal.DeleteEvent(ctx, ownerID, req.EventID, req.AttendeeEmail); err != nil {
		return nil, fmt.Errorf("calendar delete_event: %w", err)
	}
	return marshalBool("ok", true)
}

// ─── mail verbs ───

func mailConnected(
	ctx context.Context, m MailProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := m.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func mailSend(
	ctx context.Context, m MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var msg MailMessage
	if err := json.Unmarshal(args, &msg); err != nil {
		return nil, fmt.Errorf("supplier invoke: decode send args: %w", err)
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
		return nil, fmt.Errorf("supplier invoke: marshal send receipt: %w", err)
	}
	return b, nil
}

// ─── marshal helpers (all take concrete types, never touch the forbidigo-banned any) ───

func marshalBool(key string, v bool) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]bool{key: v})
	if err != nil {
		return nil, fmt.Errorf("supplier invoke: marshal %s: %w", key, err)
	}
	return b, nil
}
