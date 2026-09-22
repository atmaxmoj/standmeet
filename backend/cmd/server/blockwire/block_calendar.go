// block_calendar.go — the substrate mechanism that lets a sandbox_stdio MCP block SERVE the
// calendar seam. It is generic over the provider: the host names no block here.
//
// Seam suppliers are in-host CalendarProxy implementations; a block, until now, could only expose
// VISITOR tools. blockCalendarProxy bridges the two: it IS a CalendarProxy (so booker's
// supplier.invoke("calendar",…) resolves to it like any supplier), and it implements each calendar
// operation by dialing the block and calling its MCP tool. The owner's stored connect-form values
// are an OPAQUE blob — the host does not decode the fields (the block declares them in its manifest
// `config` and consumes them); the proxy merges that blob into the tool call and forwards it.
//
// One dial per op (the sandbox is stateless and short-lived — sandbox-lives-one-turn).

package blockwire

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockseam"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
)

// blockCredVault — a block-backed supplier's view of the credentials repo: connection state plus
// the owner's stored connect-form values as an OPAQUE JSON blob. The host does not name the fields;
// the block's manifest `config` declares them and the block consumes them.
type blockCredVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
	Credentials(ctx context.Context, blockID, ownerID string) (json.RawMessage, error)
}

// blockCalendarProxy — a calendar-seam supplier backed by an MCP block. It is still a typed
// CalendarProxy (so booker's supplier.invoke("calendar",…) resolves to it), but the merge→dial→call
// plumbing now lives in the generic blockseam.Provider — this proxy is only the typed translation
// layer on top of it (the layer the fold will next remove). Nothing here is provider-specific.
type blockCalendarProxy struct {
	vault blockCredVault
	seam  *blockseam.Provider
	// behavior — set for a spec+oauth calendar block (google-calendar): the host-side openapi
	// behavior (Connected / CanPerform scope shortfall / token refresh + base url). nil for a
	// credential block (CalDAV), which has no scopes and no oauth.
	behavior *adapters.OpenAPIBehavior
	id       string
}

func newBlockCalendarProxy(m *plugin.Manifest, vault blockCredVault) *blockCalendarProxy {
	return &blockCalendarProxy{vault: vault, seam: blockseam.New(m, vault, dialBlock), id: m.ID}
}

// newOpenAPIBlockCalendarProxy — a calendar block that executes an openapi supplier's calls
// (google-calendar): host keeps the openapi behavior (connect/scope/refresh), the block runs
// the HTTP. Its credentials are the refreshed bearer + resolved base url, merged into each
// verb call for the block's openapi engine to bear and target.
func newOpenAPIBlockCalendarProxy(
	m *plugin.Manifest, beh *adapters.OpenAPIBehavior,
) *blockCalendarProxy {
	vault := oauthBlockVault{beh: beh}
	return &blockCalendarProxy{
		vault: vault, seam: blockseam.New(m, vault, dialBlock), behavior: beh, id: m.ID,
	}
}

//nolint:ireturn // blockseam.Dial's contract is to return the Session interface (injected seam)
func dialBlock(ctx context.Context, mm *plugin.Manifest) (blockseam.Session, error) {
	return mount.DialBlock(ctx, mm)
}

// oauthBlockVault — the block-cred view for a spec+oauth calendar block: it hands the block
// the host-refreshed access token + the host-resolved base url (the block's own baked spec
// cannot env-expand ${GOOGLE_CALENDAR_BASE}, so the host supplies the target). Connected
// reads the openapi connection state.
type oauthBlockVault struct{ beh *adapters.OpenAPIBehavior }

func (v oauthBlockVault) Connected(ctx context.Context, _, ownerID string) (bool, error) {
	return v.beh.Connected(ctx, ownerID)
}

func (v oauthBlockVault) Credentials(
	ctx context.Context, _, ownerID string,
) (json.RawMessage, error) {
	b, err := v.beh.BearerFor(ctx, ownerID)
	if err != nil {
		// A host-side refresh that came back invalid_grant means the owner revoked the grant on
		// the provider — the signal the in-host openapi adapter maps via mapCalendarErr. Surface
		// it as the calendar-revoked sentinel so the owner is told to reconnect (and the card
		// drops "connected"), not "try again later". OAuth refresh is host-side, so this mapping
		// is too. (The API-side 401, token still valid, is [fault:revoked] in the block engine.)
		if errors.Is(err, adapters.ErrInvalidGrant) {
			return nil, fmt.Errorf("%w: %w", adapters.ErrCalendarRevoked, err)
		}
		return nil, err
	}
	return json.Marshal(map[string]string{"access_token": b.Token, "base_url": b.BaseURL})
}

// freeBusyArgs / insertArgs / deleteArgs — the SEAM operation's own fields (the owner's credentials
// are merged in separately, as an opaque blob).
type freeBusyArgs struct {
	TimeMin string `json:"time_min"`
	TimeMax string `json:"time_max"`
}

type insertArgs struct {
	Summary string `json:"summary"`
	// Description / TimeZone are the event body and zone the seam DTO (InsertEventReq) carries.
	// They were dropped here before reaching the block, so a booking landed as a bare summary
	// with no "Topic / With / Contact" — the "会找不到这是干什么的" the DESCRIPTION was added for.
	Description  string `json:"description,omitempty"`
	Start        string `json:"start"`
	End          string `json:"end"`
	TimeZone     string `json:"time_zone,omitempty"`
	VisitorEmail string `json:"visitor_email"`
}

type deleteArgs struct {
	EventID string `json:"event_id"`
}

// rfc3339Millis — event times with explicit milliseconds (Go's RFC3339 strips a trailing
// .000); matches the in-host openapi path so a booking time round-trips faithfully.
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

// busyReply / busyPeriod / insertReply — the tool result shapes (named, not nested literals).
type busyReply struct {
	Busy []busyPeriod `json:"busy"`
}

type busyPeriod struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type insertReply struct {
	EventID  string `json:"eventId"`
	HTMLLink string `json:"htmlLink"`
}

// Name / Kind / Connected — the Supplier base surface. Kind "block": this supplier is served by an
// MCP block, not an in-host protocol impl or an openapi spec.
func (p *blockCalendarProxy) Name() string { return p.id }
func (*blockCalendarProxy) Kind() string   { return "block" }

func (p *blockCalendarProxy) Connected(ctx context.Context, ownerID string) (bool, error) {
	return p.vault.Connected(ctx, p.id, ownerID)
}

// CanPerform — for a spec+oauth block, defer to the openapi scope-shortfall check (F-B-8:
// calendar.readonly lists slots but booking is refused). A credential block (no behavior)
// has no scopes → allow, the same answer a non-CanPerformer supplier gives today.
func (p *blockCalendarProxy) CanPerform(
	ctx context.Context, ownerID, operationID string,
) (bool, error) {
	if p.behavior == nil {
		return true, nil
	}
	return p.behavior.CanPerform(ctx, ownerID, operationID)
}

// Verify — the connection test (Verifier): call the block's `verify` tool with the owner's creds.
func (p *blockCalendarProxy) Verify(ctx context.Context, ownerID string) error {
	_, err := p.call(ctx, ownerID, "verify", nil)
	return err
}

// FreeBusy — call the block's `free_busy` tool; map its {busy:[{start,end}]} to busy intervals.
func (p *blockCalendarProxy) FreeBusy(
	ctx context.Context, ownerID string, req adapters.FreeBusyReq,
) ([]adapters.BusyInterval, error) {
	opArgs, merr := json.Marshal(freeBusyArgs{
		TimeMin: req.TimeMin.UTC().Format(time.RFC3339),
		TimeMax: req.TimeMax.UTC().Format(time.RFC3339),
	})
	if merr != nil {
		return nil, merr
	}
	out, err := p.call(ctx, ownerID, "free_busy", opArgs)
	if err != nil {
		return nil, err
	}
	var r busyReply
	if uerr := json.Unmarshal(out, &r); uerr != nil {
		return nil, fmt.Errorf("calendar block free_busy decode: %w", uerr)
	}
	return toBusyIntervals(r.Busy)
}

// insertEventArgs — map the seam DTO to the block's insert_event args. Every field the seam DTO
// carries must be forwarded: a silently dropped one (Description, before) makes the calendar event
// unreadable, and nothing fails — so this mapping is guarded by a test rather than left inline.
func insertEventArgs(req *adapters.InsertEventReq) insertArgs {
	return insertArgs{
		Summary:     req.Summary,
		Description: req.Description,
		// Explicit milliseconds (not time.RFC3339, which strips trailing .000): a booking time
		// round-trips faithfully into the calendar, matching the in-host openapi path.
		Start:        req.Start.UTC().Format(rfc3339Millis),
		End:          req.End.UTC().Format(rfc3339Millis),
		TimeZone:     req.TimeZone,
		VisitorEmail: req.VisitorEmail,
	}
}

// toBusyIntervals — parse the block's RFC3339 busy periods into the seam's busy intervals.
func toBusyIntervals(rows []busyPeriod) ([]adapters.BusyInterval, error) {
	out := make([]adapters.BusyInterval, 0, len(rows))
	for i := range rows {
		start, serr := time.Parse(time.RFC3339, rows[i].Start)
		end, eerr := time.Parse(time.RFC3339, rows[i].End)
		if serr != nil || eerr != nil {
			return nil, fmt.Errorf("calendar free_busy bad time %q/%q", rows[i].Start, rows[i].End)
		}
		out = append(out, adapters.BusyInterval{Start: start, End: end})
	}
	return out, nil
}

// InsertEvent — call the block's `insert_event` tool; map {eventId,htmlLink} back.
func (p *blockCalendarProxy) InsertEvent(
	ctx context.Context, ownerID string, req *adapters.InsertEventReq,
) (adapters.InsertedEvent, error) {
	opArgs, merr := json.Marshal(insertEventArgs(req))
	if merr != nil {
		return adapters.InsertedEvent{}, merr
	}
	out, err := p.call(ctx, ownerID, "insert_event", opArgs)
	if err != nil {
		return adapters.InsertedEvent{}, err
	}
	var r insertReply
	if uerr := json.Unmarshal(out, &r); uerr != nil {
		return adapters.InsertedEvent{}, fmt.Errorf("calendar block insert_event decode: %w", uerr)
	}
	return adapters.InsertedEvent{EventID: r.EventID, HTMLLink: r.HTMLLink}, nil
}

// DeleteEvent — call the block's `delete_event` tool (404 absorbed block-side).
func (p *blockCalendarProxy) DeleteEvent(ctx context.Context, ownerID, eventID, _ string) error {
	opArgs, merr := json.Marshal(deleteArgs{EventID: eventID})
	if merr != nil {
		return merr
	}
	_, err := p.call(ctx, ownerID, "delete_event", opArgs)
	return err
}

// CallVerb — the generic seam surface: pass the verb's raw args JSON straight to the block, with no
// typed re-marshal. The dispatcher routes through this for a verb whose typed proxy method would
// drop a field the block accepts — delete_event's `attendee_email` (→ sendUpdates=all) is lost by
// the typed DeleteEvent's fixed request struct. This is a step of the fold: the block owns the
// verb's arg shape, the host stops re-typing it. (The full collapse routes every verb this way and
// deletes the typed methods — docs/design/plugin/openapi-runtime-block.md.)
func (p *blockCalendarProxy) CallVerb(
	ctx context.Context, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	return p.seam.CallVerb(ctx, ownerID, verb, args)
}

// call — one op via the generic block-seam provider: merge the owner's opaque creds into the op's
// args, dial the block, call the tool `tool` (a dial/call/tool-level failure becomes an unavailable
// fault carrying the block's text). The typed methods above marshal their request into opArgs and
// decode the tool's reply; this line is the whole of the block plumbing now.
func (p *blockCalendarProxy) call(
	ctx context.Context, ownerID, tool string, opArgs json.RawMessage,
) (json.RawMessage, error) {
	return p.seam.CallVerb(ctx, ownerID, tool, opArgs)
}
