// openapi_adapter.go — category contract adapter: wires the generic openapi execution core
// (openapi.Runtime) into contracts consumers use (contract.CalendarProxy / MailProxy). Booker
// only knows CalendarProxy, unaware whether behind it is Google / Outlook / any SaaS with a
// spec+binding attached. One connector serves multiple owners: runtime (spec+binding) is shared;
// auth + connection state resolves per (connector, owner) via AuthManager (credentials/OAuth
// tokens stay inside, never leaving connector). openapiCore holds shared pieces
// (Name/Connected/call); calendarAdapter / mailAdapter add typed contract methods + error
// mapping (calendar→domain.ErrCalendar* / mail→usecases.ErrMail*).

package connector

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

// openapiCore — shared pieces of an assembled connector: id, runtime, connection-state source,
// auth strategy. Credentials decrypt via ConnectionStore, injected per authStrategy, never
// leaving this layer.
type openapiCore struct {
	runtime   *openapi.Runtime
	store     ConnectionStore
	auth      authStrategy
	refresher *oauthRefresher // oauth2 silent refresh; nil for non-oauth2
	id        string
	expose    bool // expose_as_agent_tools: exposes raw operations as agent tools (§3)
}

// Name — Connector base surface: the connector's name.
func (c *openapiCore) Name() string { return c.id }

// Kind — the openapi execution core always reports kind=openapi (runs over an HTTP spec+binding).
func (*openapiCore) Kind() string { return "openapi" }

// Connected — Connector base surface: is this owner connected (reads connection state).
func (c *openapiCore) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := c.store.Get(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return conn.Connected, nil
}

// CanPerform lives in openapi_can_perform.go ("can this grant perform this step" is separate).

// ExposesAgentTools — whether this connector exposes raw operations as agent tools (§3).
func (c *openapiCore) ExposesAgentTools() bool { return c.expose }

// AgentOps — one agent-tool metadata entry (tool name + summary) per spec op. Name is normalized
// to the provider's charset (agent_tool_name.go); dispatch is by OpID, so renaming it is safe.
func (c *openapiCore) AgentOps() []consumer.AgentOp {
	ops := c.runtime.Operations()
	names := agentToolNames(ops)
	out := make([]consumer.AgentOp, 0, len(ops))
	for i := range ops {
		desc := ops[i].Summary
		if desc == "" {
			desc = ops[i].Description
		}
		out = append(out, consumer.AgentOp{
			Name:        names[i],
			OpID:        ops[i].ID,
			Description: desc,
		})
	}
	return out
}

// CallAgentOp — the runtime calls the SaaS directly by operationId (injecting this owner's auth),
// returning the raw response (no mapping).
func (c *openapiCore) CallAgentOp(
	ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
) (json.RawMessage, error) {
	inj, err := c.injector(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	raw, cerr := c.runtime.RawCall(ctx, opID, argsJSON, inj)
	if cerr != nil {
		return nil, fmt.Errorf("connector %q agent call: %w", c.id, cerr)
	}
	return raw, nil
}

// injector — reads this owner's connection state, resolves an injector per authStrategy
// (credentials decrypted and injected entirely within this layer).
func (c *openapiCore) injector(ctx context.Context, ownerID string) (openapi.AuthInjector, error) {
	conn, err := c.store.Get(ctx, c.id, ownerID)
	if err != nil {
		return nil, fmt.Errorf("connector %q load: %w", c.id, err)
	}
	if c.refresher != nil {
		if rerr := c.refresher.maybeRefresh(ctx, c.id, ownerID, &conn); rerr != nil {
			return nil, fmt.Errorf("connector %q refresh: %w", c.id, rerr)
		}
	}
	inj, ierr := c.auth(&conn)
	if ierr != nil {
		return nil, fmt.Errorf("connector %q auth: %w", c.id, ierr)
	}
	return inj, nil
}

// ───────────────────────── calendar contract adaptation ─────────────────────────
// ⚠ Contract coupling (implicit but guarded): json tags on the structs below ARE the "contract
// variable names" — built-in (builtins/data/*/binding.yaml) and owner-uploaded bindings
// reference them by name in request/response JSONata (`summary` / `visitorEmail` / `start`). A
// stale tag → JSONata evaluates to undefined → field silently goes empty (§8-C, no error):
// caught for built-ins by chat-book-success.spec asserting summary/attendee/start content, for
// uploads by the diag endpoint's self-test. Tag and binding name are one piece of knowledge,
// kept in sync by that e2e assertion.

// calendarAdapter — openapiCore implementing contract.CalendarProxy.
type calendarAdapter struct{ *openapiCore }

type listBusyInput struct {
	TimeMin time.Time `json:"timeMin"`
	TimeMax time.Time `json:"timeMax"`
}

type busyRow struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type busyResult struct {
	Busy []busyRow `json:"busy"`
}

// rfc3339Millis — send event times with milliseconds (Go's default RFC3339Nano strips trailing
// .000 zeros; explicit millis let a booking time round-trip faithfully into the calendar).
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

const idempotencyKeyBytes = 16

// newIdempotencyKey — random 16B hex key for one write op, generated once per InsertEvent call
// and reused across its retry span; the external side dedupes by it, so jitter retries don't dup.
func newIdempotencyKey() (string, error) {
	buf := make([]byte, idempotencyKeyBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gen idempotency key: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

type insertEventInput struct {
	Summary        string `json:"summary"`
	Description    string `json:"description"`
	Start          string `json:"start"`
	End            string `json:"end"`
	TimeZone       string `json:"timeZone"`
	VisitorEmail   string `json:"visitorEmail"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type insertedResult struct {
	EventID  string `json:"id"`
	HTMLLink string `json:"htmlLink"`
}

type cancelInput struct {
	EventID       string `json:"eventId"`
	AttendeeEmail string `json:"attendeeEmail"`
}

// FreeBusy — the list_busy contract method.
func (a calendarAdapter) FreeBusy(
	ctx context.Context, ownerID string, req contract.FreeBusyReq,
) ([]contract.BusyInterval, error) {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return nil, mapCalendarErr(err)
	}
	var out busyResult
	in := listBusyInput{TimeMin: req.TimeMin, TimeMax: req.TimeMax}
	if cerr := retry.Do(ctx, calendarReadPolicy(), func() error {
		return a.runtime.Call(ctx, "list_busy", in, &out, inj)
	}); cerr != nil {
		return nil, mapCalendarErr(cerr)
	}
	intervals := make([]contract.BusyInterval, 0, len(out.Busy))
	for i := range out.Busy {
		b := out.Busy[i]
		intervals = append(intervals, contract.BusyInterval{Start: b.Start, End: b.End})
	}
	return intervals, nil
}

// InsertEvent — the create_event contract method.
func (a calendarAdapter) InsertEvent(
	ctx context.Context, ownerID string, req *contract.InsertEventReq,
) (contract.InsertedEvent, error) {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return contract.InsertedEvent{}, mapCalendarErr(err)
	}
	key, kerr := newIdempotencyKey() // one per call, reused on retries, no dup create (D-7)
	if kerr != nil {
		return contract.InsertedEvent{}, kerr
	}
	in := insertEventInput{
		Summary: req.Summary, Description: req.Description,
		Start:    req.Start.Format(rfc3339Millis),
		End:      req.End.Format(rfc3339Millis),
		TimeZone: req.TimeZone, VisitorEmail: req.VisitorEmail,
		IdempotencyKey: key,
	}
	var out insertedResult
	if cerr := retry.Do(ctx, calendarWritePolicy(), func() error {
		return a.runtime.Call(ctx, "create_event", in, &out, inj)
	}); cerr != nil {
		return contract.InsertedEvent{}, mapCalendarErr(cerr)
	}
	return contract.InsertedEvent{EventID: out.EventID, HTMLLink: out.HTMLLink}, nil
}

// DeleteEvent — the cancel_event contract method.
func (a calendarAdapter) DeleteEvent(
	ctx context.Context, ownerID, eventID, attendeeEmail string,
) error {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return mapCalendarErr(err)
	}
	in := cancelInput{EventID: eventID, AttendeeEmail: attendeeEmail}
	if cerr := retry.Do(ctx, calendarWritePolicy(), func() error {
		return a.runtime.Call(ctx, "cancel_event", in, nil, inj)
	}); cerr != nil {
		return mapCalendarErr(cerr)
	}
	return nil
}

// mapCalendarErr — maps an execution-core error into a calendar-domain error (friendly
// downgrade): invalid_grant/401 → revoked; 429/5xx/jitter → "try again later"; else wrapped as-is.
func mapCalendarErr(err error) error {
	if err == nil {
		return nil
	}
	if d := mapCalendarSentinel(err); d != nil {
		return d
	}
	if mapped := mapStatusErr(err); mapped != nil {
		return mapped
	}
	if openapiTransient(err) {
		return contract.ErrCalendarUnavailable
	}
	return fmt.Errorf("calendar: %w", err)
}

// mapCalendarSentinel — sentinel-error mapping: invalid_grant → revoked; a pre-flight missing
// field / outbound blocked by SSRF → bad request (client/config error, 4xx, not upstream fault).
func mapCalendarSentinel(err error) error {
	if errors.Is(err, ErrInvalidGrant) {
		return contract.ErrCalendarRevoked
	}
	if errors.Is(err, ErrBlockedEgress) { // a clean sentinel (doesn't echo the internal URL back)
		return contract.ErrCalendarBlockedEgress
	}
	if errors.Is(err, openapi.ErrMissingRequired) {
		return fmt.Errorf("%w: %w", contract.ErrCalendarBadRequest, err)
	}
	return nil
}

// mapStatusErr — StatusError-specific mapping (transient → unavailable; 401 → revoked); else nil.
func mapStatusErr(err error) error {
	var se *openapi.StatusError
	if !errors.As(err, &se) {
		return nil
	}
	if se.Transient {
		return contract.ErrCalendarUnavailable
	}
	if se.Code == http.StatusUnauthorized {
		return contract.ErrCalendarRevoked
	}
	return nil
}

// ───────────────────────── mail contract adaptation ─────────────────────────

// mailAdapter — openapiCore implementing contract.MailProxy.
type mailAdapter struct{ *openapiCore }

type sendInput struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"`
}

// Send — the send contract method. Deliberately asymmetric with calendarAdapter: no retry,
// because sending isn't idempotent (no idempotency key, providers generally don't dedupe) —
// retrying a transient error risks duplicates, so failing beats resending (scenarios that do
// need a retry, e.g. owner notifications, wrap with notifyPolicy at the usecase layer instead);
// and no mapping into a domain error, since mail consumers (booking_confirmation / owner_notify
// / otp) only care whether it sent, unlike booker gating on revoked/unavailable — calendar's
// error vocabulary isn't needed here (ISP: don't build an interface nobody uses).
// Output is no longer nil (F-C-55): `send.response` always mapped out the provider's id,
// previously evaluated then discarded — the only post-send handle (log lookup, bounce match,
// telling the owner what sent). Unreadable → empty ("provider didn't give one"), not failure.
func (a mailAdapter) Send(
	ctx context.Context, ownerID string, msg contract.MailMessage,
) (contract.MailReceipt, error) {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return contract.MailReceipt{}, err
	}
	in := sendInput{To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML}
	var out sendOutput
	if cerr := a.runtime.Call(ctx, "send", in, &out, inj); cerr != nil {
		return contract.MailReceipt{}, classifyMailSendErr(cerr)
	}
	return contract.MailReceipt{ProviderID: out.ID}, nil
}

// sendOutput — shape evaluated from `send.response`; field matches existing bindings (`{"id":…}`).
type sendOutput struct {
	ID string `json:"id"`
}

// classifyMailSendErr — sorts a runtime error into one of two mail sentinels (temporarily
// unavailable / message rejected). The original error stays in the %w chain for logging; the
// contract surface only reads the sentinel. Classification lives here, not on the surface,
// because "429/5xx counts as transient" is this runtime's knowledge, not the surface's.
func classifyMailSendErr(err error) error {
	var se *openapi.StatusError
	if errors.As(err, &se) && !se.Transient {
		return fmt.Errorf("%w: %w", contract.ErrMailRejected, err)
	}
	return fmt.Errorf("%w: %w", contract.ErrMailUnavailable, err)
}
