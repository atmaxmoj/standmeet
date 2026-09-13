// block_calendar.go — the substrate mechanism that lets a sandbox_stdio MCP block SERVE the
// calendar seam.
//
// Seam suppliers are in-host CalendarProxy implementations; a block, until now, could only expose
// VISITOR tools. blockCalendarProxy bridges the two: it IS a CalendarProxy (so booker's
// supplier.invoke("calendar",…) resolves to it like any supplier), and it implements each calendar
// operation by dialing the block and calling its MCP tool, injecting the owner's stored
// credentials. The Go here is the SUBSTRATE talking to a block — the block itself
// (infra/plugins/caldav, a Koishi plugin) carries no Go. This is how CalDAV stops being ~400 lines
// of in-host Go and becomes a block.
//
// One dial per op (the sandbox is stateless and short-lived — sandbox-lives-one-turn); a booking
// is a free_busy + an insert, so the bwrap cold start is paid a couple of times per booking, which
// is acceptable and keeps the proxy free of session lifecycle.

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
)

// blockCalendarProxy — a calendar-seam supplier backed by an MCP block. Holds the full manifest
// (to dial the block) + the credential vault (the owner's url/user/pass, which never reach the
// block except as the per-call tool args the substrate injects).
type blockCalendarProxy struct {
	vault    adapters.CalDAVVault
	id       string
	manifest plugin.Manifest
}

func newBlockCalendarProxy(m *plugin.Manifest, vault adapters.CalDAVVault) *blockCalendarProxy {
	return &blockCalendarProxy{manifest: *m, vault: vault, id: m.ID}
}

// calConn — the credential args every caldav tool call carries (host-injected, not LLM-chosen).
// Embedded into each op's args struct, so it flattens to url/username/password in the JSON.
type calConn struct {
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type freeBusyArgs struct {
	calConn

	TimeMin string `json:"time_min"`
	TimeMax string `json:"time_max"`
}

type insertArgs struct {
	calConn

	Summary      string `json:"summary"`
	Start        string `json:"start"`
	End          string `json:"end"`
	VisitorEmail string `json:"visitor_email"`
}

type deleteArgs struct {
	calConn

	EventID string `json:"event_id"`
}

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

// Verify — the connection test (Verifier): call the block's `verify` tool with the owner's creds.
func (p *blockCalendarProxy) Verify(ctx context.Context, ownerID string) error {
	c, err := p.conn(ctx, ownerID)
	if err != nil {
		return err
	}
	raw, merr := json.Marshal(c)
	if merr != nil {
		return merr
	}
	_, verr := p.callTool(ctx, "verify", raw)
	return verr
}

// FreeBusy — call the block's `free_busy` tool; map its {busy:[{start,end}]} to busy intervals.
func (p *blockCalendarProxy) FreeBusy(
	ctx context.Context, ownerID string, req adapters.FreeBusyReq,
) ([]adapters.BusyInterval, error) {
	c, err := p.conn(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	raw, merr := json.Marshal(freeBusyArgs{
		calConn: c,
		TimeMin: req.TimeMin.UTC().Format(time.RFC3339),
		TimeMax: req.TimeMax.UTC().Format(time.RFC3339),
	})
	if merr != nil {
		return nil, merr
	}
	out, cerr := p.callTool(ctx, "free_busy", raw)
	if cerr != nil {
		return nil, cerr
	}
	var r busyReply
	if uerr := json.Unmarshal(out, &r); uerr != nil {
		return nil, fmt.Errorf("caldav free_busy decode: %w", uerr)
	}
	return toBusyIntervals(r.Busy)
}

// toBusyIntervals — parse the block's RFC3339 busy periods into the seam's busy intervals.
func toBusyIntervals(rows []busyPeriod) ([]adapters.BusyInterval, error) {
	out := make([]adapters.BusyInterval, 0, len(rows))
	for i := range rows {
		start, serr := time.Parse(time.RFC3339, rows[i].Start)
		end, eerr := time.Parse(time.RFC3339, rows[i].End)
		if serr != nil || eerr != nil {
			return nil, fmt.Errorf("caldav free_busy bad time %q/%q", rows[i].Start, rows[i].End)
		}
		out = append(out, adapters.BusyInterval{Start: start, End: end})
	}
	return out, nil
}

// InsertEvent — call the block's `insert_event` tool; map {eventId,htmlLink} back.
func (p *blockCalendarProxy) InsertEvent(
	ctx context.Context, ownerID string, req *adapters.InsertEventReq,
) (adapters.InsertedEvent, error) {
	c, err := p.conn(ctx, ownerID)
	if err != nil {
		return adapters.InsertedEvent{}, err
	}
	raw, merr := json.Marshal(insertArgs{
		calConn: c, Summary: req.Summary,
		Start:        req.Start.UTC().Format(time.RFC3339),
		End:          req.End.UTC().Format(time.RFC3339),
		VisitorEmail: req.VisitorEmail,
	})
	if merr != nil {
		return adapters.InsertedEvent{}, merr
	}
	out, cerr := p.callTool(ctx, "insert_event", raw)
	if cerr != nil {
		return adapters.InsertedEvent{}, cerr
	}
	var r insertReply
	if uerr := json.Unmarshal(out, &r); uerr != nil {
		return adapters.InsertedEvent{}, fmt.Errorf("caldav insert_event decode: %w", uerr)
	}
	return adapters.InsertedEvent{EventID: r.EventID, HTMLLink: r.HTMLLink}, nil
}

// DeleteEvent — call the block's `delete_event` tool (404 absorbed block-side).
func (p *blockCalendarProxy) DeleteEvent(ctx context.Context, ownerID, eventID, _ string) error {
	c, err := p.conn(ctx, ownerID)
	if err != nil {
		return err
	}
	raw, merr := json.Marshal(deleteArgs{calConn: c, EventID: eventID})
	if merr != nil {
		return merr
	}
	_, cerr := p.callTool(ctx, "delete_event", raw)
	return cerr
}

// conn — read the owner's decrypted CalDAV credentials into the per-call connection args.
func (p *blockCalendarProxy) conn(ctx context.Context, ownerID string) (calConn, error) {
	cfg, err := p.vault.CalDAVConfig(ctx, p.id, ownerID)
	if err != nil {
		return calConn{}, fmt.Errorf("caldav config: %w", err)
	}
	return calConn{URL: cfg.URL, Username: cfg.Username, Password: cfg.Password}, nil
}

// callTool — one dial: start the block's transport, call the tool with the pre-marshaled args,
// return the tool's JSON payload. A tool-level failure (IsError) becomes a Go error carrying the
// block's text.
func (p *blockCalendarProxy) callTool(
	ctx context.Context, tool string, args json.RawMessage,
) (json.RawMessage, error) {
	sess, derr := mount.DialBlock(ctx, &p.manifest)
	if derr != nil {
		return nil, fmt.Errorf("dial caldav block: %w", derr)
	}
	defer sess.Close()
	res, terr := sess.CallToolChecked(ctx, tool, args, nil, 0)
	if terr != nil {
		return nil, fmt.Errorf("caldav %s: %w", tool, terr)
	}
	if res.IsError {
		return nil, fmt.Errorf("caldav %s failed: %s", tool, res.Text)
	}
	return json.RawMessage(res.Text), nil
}
