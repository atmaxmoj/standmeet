// protocol_caldav.go — the protocol-kind CalDAV connector: a generic protocol (any CalDAV
// server: Fastmail/Apple/Nextcloud…) implementing the calendar category contract
// (contract.CalendarProxy). Sits alongside the openapi adapter and the SMTP connector — all
// three land on the same CalendarProxy contract, and the consumer (booker) has no idea whether
// it's an HTTP API, CalDAV, or Google behind it. Credentials (url/user/pass) come decrypted
// from CalDAVVault per (connector, owner) and never leave this layer.

package connector

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// CalDAVConfig — the decrypted configuration for a CalDAV connector.
type CalDAVConfig struct {
	URL      string
	Username string
	Password string
}

// Configured — whether the minimum connectable configuration is filled in (has a collection
// URL).
func (c *CalDAVConfig) Configured() bool { return c.URL != "" }

// CalDAVVault — the connection source for a protocol(caldav) connector: connection state +
// decrypted config.
type CalDAVVault interface {
	Connected(ctx context.Context, connectorID, ownerID string) (bool, error)
	CalDAVConfig(ctx context.Context, connectorID, ownerID string) (CalDAVConfig, error)
}

// caldavConnector — implements the Connector base surface + Verifier + contract.CalendarProxy.
type caldavConnector struct {
	vault CalDAVVault
	doer  openapi.Doer
	id    string
}

// NewCalDAVConnector — assemble a CalDAV protocol connector (doer = the SSRF-guarded outbound
// client).
func NewCalDAVConnector(id string, vault CalDAVVault, doer openapi.Doer) Connector {
	return &caldavConnector{vault: vault, doer: doer, id: id}
}

// Name — Connector base surface.
func (c *caldavConnector) Name() string { return c.id }

// Kind — a protocol connector always reports kind=protocol.
func (*caldavConnector) Kind() string { return "protocol" }

// Connected — is this owner connected.
func (c *caldavConnector) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return conn, nil
}

// Verify — connection test: send one PROPFIND against the collection (no write). Missing
// config / unreachable → error.
func (c *caldavConnector) Verify(ctx context.Context, ownerID string) error {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return err
	}
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{
		Method: "PROPFIND", URL: creds.URL, ContentType: caldavReportType,
	})
	if rerr != nil {
		return fmt.Errorf("connector %q caldav verify: %w", c.id, rerr)
	}
	if r.Status >= http.StatusBadRequest {
		return fmt.Errorf("connector %q caldav verify: status %d", c.id, r.Status)
	}
	return nil
}

// FreeBusy — CalDAV free-busy-query REPORT → normalized busy-time ranges.
func (c *caldavConnector) FreeBusy(
	ctx context.Context, ownerID string, req contract.FreeBusyReq,
) ([]contract.BusyInterval, error) {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{
		Method: "REPORT", URL: creds.URL,
		Body: freeBusyQuery(req.TimeMin, req.TimeMax), ContentType: caldavReportType,
	})
	if rerr != nil {
		return nil, contract.ErrCalendarUnavailable
	}
	if serr := caldavStatusErr(r.Status); serr != nil {
		return nil, serr
	}
	return busyIntervals(r.Body)
}

// busyIntervals — translates a free-busy response into the contract's busy-time ranges.
// **Unreadable → error, not "no busy time"** (F-C-50): the caller uses this to say "your
// calendar couldn't be checked", instead of scheduling into a day that was actually just
// unreadable, not empty.
func busyIntervals(body string) ([]contract.BusyInterval, error) {
	rows, perr := parseFreeBusy(body)
	if perr != nil {
		return nil, fmt.Errorf("caldav free-busy: %w", perr)
	}
	out := make([]contract.BusyInterval, 0, len(rows))
	for i := range rows {
		out = append(out, contract.BusyInterval{Start: rows[i].Start, End: rows[i].End})
	}
	return out, nil
}

// InsertEvent — PUT an iCalendar VEVENT to create a meeting (UID idempotent: a retry with the
// same UID doesn't double-book).
func (c *caldavConnector) InsertEvent(
	ctx context.Context, ownerID string, req *contract.InsertEventReq,
) (contract.InsertedEvent, error) {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return contract.InsertedEvent{}, err
	}
	uid, kerr := newIdempotencyKey()
	if kerr != nil {
		return contract.InsertedEvent{}, kerr
	}
	ev := buildVEvent(uid, req.Summary, req.Start, req.End, req.VisitorEmail)
	url := creds.URL + "/" + uid + ".ics"
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{
		Method: http.MethodPut, URL: url, Body: ev, ContentType: caldavICalType,
	})
	if rerr != nil {
		// Keeps the real cause (dial / SSRF / transport error) — the caller's marshalBookErr
		// records it server-side, while the visitor still gets the friendly "try again later"
		// mapping. This used to swallow it straight into ErrCalendarUnavailable, leaving ops
		// nothing to investigate (fail-loud).
		return contract.InsertedEvent{}, fmt.Errorf("caldav insert PUT %s: %w: %w",
			url, contract.ErrCalendarUnavailable, rerr)
	}
	if serr := caldavStatusErr(r.Status); serr != nil {
		return contract.InsertedEvent{}, fmt.Errorf("caldav insert PUT %s status %d: %w",
			url, r.Status, serr)
	}
	return contract.InsertedEvent{EventID: uid, HTMLLink: url}, nil
}

// DeleteEvent — DELETE the meeting's .ics (cancel).
func (c *caldavConnector) DeleteEvent(ctx context.Context, ownerID, eventID, _ string) error {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return err
	}
	url := creds.URL + "/" + eventID + ".ics"
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{Method: http.MethodDelete, URL: url})
	if rerr != nil {
		return contract.ErrCalendarUnavailable
	}
	return caldavStatusErr(r.Status)
}

// creds — decrypt this owner's CalDAV config; not configured → ErrCalendarNotConnected.
func (c *caldavConnector) creds(ctx context.Context, ownerID string) (*caldavCreds, error) {
	cfg, err := c.vault.CalDAVConfig(ctx, c.id, ownerID)
	if err != nil {
		return nil, fmt.Errorf("connector %q caldav config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return nil, contract.ErrCalendarNotConnected
	}
	return &caldavCreds{URL: cfg.URL, Username: cfg.Username, Password: cfg.Password}, nil
}

// caldavResp — the result of one CalDAV call (body + status code; a struct because the
// function-result-limit is ≤2).
type caldavResp struct {
	Body   string
	Status int
}

// caldavCall — send the request + read the body + close the body (read error takes priority,
// close error second). A network error surfacing here gets mapped by the caller to a downgrade.
func caldavCall(
	ctx context.Context, doer openapi.Doer, creds *caldavCreds, r *caldavRequest,
) (caldavResp, error) {
	resp, err := caldavReq(ctx, doer, creds, r)
	if err != nil {
		return caldavResp{}, err
	}
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxCalDAVBytes))
	cerr := resp.Body.Close()
	if rerr != nil {
		return caldavResp{}, fmt.Errorf("read caldav body: %w", rerr)
	}
	if cerr != nil {
		return caldavResp{}, fmt.Errorf("close caldav body: %w", cerr)
	}
	return caldavResp{Body: string(raw), Status: resp.StatusCode}, nil
}

// caldavStatusErr — status code → calendar-domain error (401/403 → revoked; 429/5xx →
// unavailable; other 4xx → bad request). 2xx/3xx → nil.
func caldavStatusErr(code int) error {
	switch {
	case code < http.StatusBadRequest:
		return nil
	case caldavAuthErr(code):
		return contract.ErrCalendarRevoked
	case caldavTransient(code):
		return contract.ErrCalendarUnavailable
	default:
		return contract.ErrCalendarBadRequest
	}
}

func caldavAuthErr(code int) bool {
	return code == http.StatusUnauthorized || code == http.StatusForbidden
}

func caldavTransient(code int) bool {
	return code == http.StatusTooManyRequests || code >= http.StatusInternalServerError
}
