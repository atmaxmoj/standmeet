// slots.go — category-slot dispatch: routes a category contract to the owner's active connector
// (§9 slot rule). Hub holds connectors by connector_id; SlotStore resolves which one is active
// per owner+category. Consumers (booker/mailer) see only contract.CalendarProxy/MailProxy, never
// the provider or kind — the last link between the base (Hub+dispatch) and a specific connector.

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

// errNoActiveConnector — owner has no active connector for this category (or it dropped out of
// the Hub). Internal sentinel the dispatcher maps to each category's "not connected" error (gated).
var errNoActiveConnector = errors.New("no active connector for category")

// SlotStore — active connector id per owner+category (§9); empty=no active; from ConnectorRepo.
type SlotStore interface {
	ActiveConnectorID(ctx context.Context, ownerID, category string) (string, error)
}

// Slots — the dispatcher from category contract → active connector.
type Slots struct {
	hub   *Hub
	store SlotStore
	log   *slog.Logger // where a background call failure goes; injected by SetLogger
}

// NewSlots — composition root injects Hub + active resolution.
func NewSlots(hub *Hub, store SlotStore) *Slots { return &Slots{hub: hub, store: store} }

// Register — adds a (runtime-assembled, uploaded) connector to the Hub (idempotent); used by
// POST /connectors.
func (s *Slots) Register(c Connector) { s.hub.Upsert(c) }

// CanPerformer — a connector that can answer "can this owner's grant perform this one operation".
// openapi implements it (spec's per-op scope vs. scope on the connection row); protocol doesn't.
type CanPerformer interface {
	CanPerform(ctx context.Context, ownerID, operationID string) (bool, error)
}

// CanPerform — whether a category's active connector can perform this one operation (F-B-8).
// Allow when it can't answer (unlike blocking on "not connected"): protocol connectors have no
// notion of scope, and treating "can't answer" as "can't do it" would hide a whole class of
// connectors' actions — the "removed a working action while fixing an unaskable one" this fix
// avoids. The class that genuinely can't do it returns false explicitly.
func (s *Slots) CanPerform(
	ctx context.Context, ownerID, category, operationID string,
) (bool, error) {
	c, err := s.active(ctx, ownerID, category)
	if err != nil {
		if errors.Is(err, errNoActiveConnector) {
			// not even connected, naturally can't do it; the capability layer also gates this.
			return false, nil
		}
		return false, err
	}
	cp, ok := c.(CanPerformer)
	if !ok {
		return true, nil
	}
	can, cerr := cp.CanPerform(ctx, ownerID, operationID)
	if cerr != nil {
		return false, fmt.Errorf("connector %q can-perform %q: %w", category, operationID, cerr)
	}
	return can, nil
}

// ConnectorCalendar — one connector's CalendarProxy by id (diag: bypasses the active slot). Not
// collapsed into a generic resolveAs[T]: Go has no generic methods, a method interface can't be
// unioned into a constraint, and [T any] is banned by forbidigo at the business layer.
func (s *Slots) ConnectorCalendar(id string) (contract.CalendarProxy, bool) {
	c, ok := s.hub.Resolve(id)
	if !ok {
		return nil, false
	}
	cal, isCal := c.(contract.CalendarProxy)
	return cal, isCal
}

// ConnectorMail — one connector's MailProxy by id (diag: bypasses the active slot).
func (s *Slots) ConnectorMail(id string) (contract.MailProxy, bool) {
	c, ok := s.hub.Resolve(id)
	if !ok {
		return nil, false
	}
	m, isMail := c.(contract.MailProxy)
	return m, isMail
}

// AgentConnectorsByID — from a set of connector ids, the ones implementing AgentToolConnector
// with expose on (§3: openapi exposes raw ops as agent tools). A slice, for a per-session source.
func (s *Slots) AgentConnectorsByID(ids []string) []consumer.AgentToolConnector {
	out := make([]consumer.AgentToolConnector, 0, len(ids))
	for _, id := range ids {
		c, ok := s.hub.Resolve(id)
		if !ok {
			continue
		}
		if atc, isAgent := c.(consumer.AgentToolConnector); isAgent && atc.ExposesAgentTools() {
			out = append(out, atc)
		}
	}
	return out
}

// AgentOpsByID — the agent ops each connector exposes, grouped by connector. Differs from
// AgentConnectorsByID only in this: that one is for session assembly and drops the id; this one
// is for owner authorization, where the UI must say which connector an op belongs to.
func (s *Slots) AgentOpsByID(ids []string) map[string][]AgentOpView {
	out := make(map[string][]AgentOpView, len(ids))
	for _, id := range ids {
		c, ok := s.hub.Resolve(id)
		if !ok {
			continue
		}
		atc, isAgent := c.(consumer.AgentToolConnector)
		if !isAgent || !atc.ExposesAgentTools() {
			continue
		}
		out[id] = toAgentOpViews(atc.AgentOps())
	}
	return out
}

// AgentOpView — an authorizable op, as seen from outside; keeps the composition root ignorant
// of `connector/consumer`.
type AgentOpView struct {
	Name        string
	Description string
}

func toAgentOpViews(ops []consumer.AgentOp) []AgentOpView {
	out := make([]AgentOpView, 0, len(ops))
	for i := range ops {
		out = append(out, AgentOpView{Name: ops[i].Name, Description: ops[i].Description})
	}
	return out
}

// AgentCall — diag/agent-call: resolves a connector by id, runs one op (injects auth, calls the
// SaaS), returns the raw response. Not registered / not agent → errNoActiveConnector (→ 404).
func (s *Slots) AgentCall(
	ctx context.Context, id, ownerID, opID string, args json.RawMessage,
) (json.RawMessage, error) {
	c, ok := s.hub.Resolve(id)
	if !ok {
		return nil, fmt.Errorf("agent call %q: %w", id, errNoActiveConnector)
	}
	atc, isAgent := c.(consumer.AgentToolConnector)
	if !isAgent {
		return nil, fmt.Errorf("agent call %q: %w", id, errNoActiveConnector)
	}
	raw, err := atc.CallAgentOp(ctx, ownerID, opID, args)
	if err != nil {
		return nil, fmt.Errorf("agent call %q: %w", id, err)
	}
	return raw, nil
}

// MailKind — the active mail connector's kind (openapi/protocol); no active → empty. The
// consumer (test-send) reports this as via_kind, proving "mailer doesn't discriminate by kind".
func (s *Slots) MailKind(ctx context.Context, ownerID string) string {
	c, err := s.active(ctx, ownerID, "mail")
	if err != nil {
		return ""
	}
	return c.Kind()
}

// VerifyConnector — resolves by name and runs a connection test (protocol connect). Not
// registered → error; not a Verifier → nil (save-and-use, no test needed).
func (s *Slots) VerifyConnector(ctx context.Context, connectorID, ownerID string) error {
	c, ok := s.hub.Resolve(connectorID)
	if !ok {
		return fmt.Errorf("verify connector %q: %w", connectorID, errNoActiveConnector)
	}
	v, isVerifier := c.(Verifier)
	if !isVerifier {
		return nil
	}
	if err := v.Verify(ctx, ownerID); err != nil {
		return fmt.Errorf("verify connector %q: %w", connectorID, err)
	}
	return nil
}

// Calendar — a CalendarProxy that dispatches the calendar contract to the active connector.
func (s *Slots) Calendar() contract.CalendarProxy { return calendarSlot{s: s} }

// Mail — a MailProxy that dispatches the mail contract to the active connector.
func (s *Slots) Mail() contract.MailProxy { return mailSlot{s: s} }

// active — an owner's active connector handle for a category. No active/not registered →
// errNoActiveConnector.
func (s *Slots) active(ctx context.Context, ownerID, category string) (Connector, error) {
	id, err := s.store.ActiveConnectorID(ctx, ownerID, category)
	if err != nil {
		return nil, fmt.Errorf("resolve active %s connector: %w", category, err)
	}
	if id == "" {
		return nil, errNoActiveConnector
	}
	c, found := s.hub.Resolve(id)
	if !found {
		return nil, errNoActiveConnector
	}
	return c, nil
}

// ─── calendar slot ───

type calendarSlot struct{ s *Slots }

// Connected — true when the active calendar connector is connected; no active → false.
func (cs calendarSlot) Connected(ctx context.Context, ownerID string) (bool, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if errors.Is(err, contract.ErrCalendarNotConnected) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	ok, cerr := cal.Connected(ctx, ownerID)
	if cerr != nil {
		return false, fmt.Errorf("calendar slot connected: %w", cerr)
	}
	return ok, nil
}

func (cs calendarSlot) FreeBusy(
	ctx context.Context, ownerID string, req contract.FreeBusyReq,
) ([]contract.BusyInterval, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	busy, ferr := cal.FreeBusy(ctx, ownerID, req)
	if ferr != nil {
		return nil, fmt.Errorf("calendar slot freebusy: %w", ferr)
	}
	return busy, nil
}

func (cs calendarSlot) InsertEvent(
	ctx context.Context, ownerID string, req *contract.InsertEventReq,
) (contract.InsertedEvent, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return contract.InsertedEvent{}, err
	}
	ev, ierr := cal.InsertEvent(ctx, ownerID, req)
	if ierr != nil {
		return contract.InsertedEvent{}, fmt.Errorf("calendar slot insert: %w", ierr)
	}
	return ev, nil
}

func (cs calendarSlot) DeleteEvent(
	ctx context.Context, ownerID, eventID, attendeeEmail string,
) error {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return err
	}
	if derr := cal.DeleteEvent(ctx, ownerID, eventID, attendeeEmail); derr != nil {
		return fmt.Errorf("calendar slot delete: %w", derr)
	}
	return nil
}

// resolve — asserts the active calendar connector to CalendarProxy. No active →
// ErrCalendarNotConnected.
func (cs calendarSlot) resolve(
	ctx context.Context, ownerID string,
) (contract.CalendarProxy, error) {
	c, err := cs.s.active(ctx, ownerID, "calendar")
	if errors.Is(err, errNoActiveConnector) {
		return nil, contract.ErrCalendarNotConnected
	}
	if err != nil {
		return nil, err
	}
	cal, isCal := c.(contract.CalendarProxy)
	if !isCal {
		return nil, fmt.Errorf("connector %q is not a calendar connector", c.Name())
	}
	return cal, nil
}

// ─── mail slot ───

type mailSlot struct{ s *Slots }

// Connected — true when an active mail connector exists and is connected; no active → false.
func (ms mailSlot) Connected(ctx context.Context, ownerID string) (bool, error) {
	mp, err := ms.resolve(ctx, ownerID)
	if errors.Is(err, consumer.ErrMailNotConfigured) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	ok, cerr := mp.Connected(ctx, ownerID)
	if cerr != nil {
		return false, fmt.Errorf("mail slot connected: %w", cerr)
	}
	return ok, nil
}

func (ms mailSlot) Send(
	ctx context.Context, ownerID string, msg contract.MailMessage,
) (contract.MailReceipt, error) {
	mp, err := ms.resolve(ctx, ownerID)
	if err != nil {
		return contract.MailReceipt{}, err
	}
	rcpt, serr := mp.Send(ctx, ownerID, msg)
	if serr != nil {
		return contract.MailReceipt{}, fmt.Errorf("mail slot send: %w", serr)
	}
	return rcpt, nil
}

// resolve — asserts the active mail connector to MailProxy. No active → ErrMailNotConfigured.
func (ms mailSlot) resolve(ctx context.Context, ownerID string) (contract.MailProxy, error) {
	c, err := ms.s.active(ctx, ownerID, "mail")
	if errors.Is(err, errNoActiveConnector) {
		return nil, consumer.ErrMailNotConfigured
	}
	if err != nil {
		return nil, err
	}
	mp, isMail := c.(contract.MailProxy)
	if !isMail {
		return nil, fmt.Errorf("connector %q is not a mail connector", c.Name())
	}
	return mp, nil
}
