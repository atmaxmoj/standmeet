// protocol_caldav.go — the protocol-kind CalDAV supplier: a generic protocol (any CalDAV
// server: Fastmail/Apple/Nextcloud…) implementing the calendar seam contract
// (CalendarProxy). Sits alongside the openapi adapter and the SMTP supplier — all
// three land on the same CalendarProxy contract, and the consumer (booker) has no idea whether
// it's an HTTP API, CalDAV, or Google behind it. Credentials (url/user/pass) come decrypted
// from CalDAVVault per (block, owner) and never leave this layer.

package adapters

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/openapi"
)

// CalDAVConfig — the decrypted configuration for a CalDAV supplier.
type CalDAVConfig struct {
	URL      string
	Username string
	Password string
}

// Configured — whether the minimum connectable configuration is filled in (has a collection
// URL).
func (c *CalDAVConfig) Configured() bool { return c.URL != "" }

// CalDAVVault — the connection source for a protocol(caldav) supplier: connection state +
// decrypted config.
type CalDAVVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
	CalDAVConfig(ctx context.Context, blockID, ownerID string) (CalDAVConfig, error)
}

// caldavSupplier — implements the Supplier base surface + Verifier + CalendarProxy.
type caldavSupplier struct {
	vault CalDAVVault
	doer  openapi.Doer
	id    string
}

// NewCalDAVSupplier — assemble a CalDAV protocol supplier (doer = the SSRF-guarded outbound
// client).
func NewCalDAVSupplier(id string, vault CalDAVVault, doer openapi.Doer) Supplier {
	return &caldavSupplier{vault: vault, doer: doer, id: id}
}

// Name — Supplier base surface.
func (c *caldavSupplier) Name() string { return c.id }

// Kind — a protocol supplier always reports kind=protocol.
func (*caldavSupplier) Kind() string { return "protocol" }

// Connected — is this owner connected.
func (c *caldavSupplier) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("supplier %q connected: %w", c.id, err)
	}
	return conn, nil
}

// Verify — connection test: send one PROPFIND against the collection (no write). Missing
// config / unreachable → error.
func (c *caldavSupplier) Verify(ctx context.Context, ownerID string) error {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return err
	}
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{
		Method: "PROPFIND", URL: creds.URL, ContentType: caldavReportType,
	})
	if rerr != nil {
		return fmt.Errorf("supplier %q caldav verify: %w", c.id, rerr)
	}
	if r.Status >= http.StatusBadRequest {
		return fmt.Errorf("supplier %q caldav verify: status %d", c.id, r.Status)
	}
	return nil
}

// FreeBusy — CalDAV free-busy-query REPORT → normalized busy-time ranges.
func (c *caldavSupplier) FreeBusy(
	ctx context.Context, ownerID string, req FreeBusyReq,
) ([]BusyInterval, error) {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{
		Method: "REPORT", URL: creds.URL,
		Body: freeBusyQuery(req.TimeMin, req.TimeMax), ContentType: caldavReportType,
	})
	if rerr != nil {
		return nil, ErrCalendarUnavailable
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
func busyIntervals(body string) ([]BusyInterval, error) {
	rows, perr := parseFreeBusy(body)
	if perr != nil {
		return nil, fmt.Errorf("caldav free-busy: %w", perr)
	}
	out := make([]BusyInterval, 0, len(rows))
	for i := range rows {
		out = append(out, BusyInterval{Start: rows[i].Start, End: rows[i].End})
	}
	return out, nil
}

// InsertEvent — PUT an iCalendar VEVENT to create a meeting (UID idempotent: a retry with the
// same UID doesn't double-book).
func (c *caldavSupplier) InsertEvent(
	ctx context.Context, ownerID string, req *InsertEventReq,
) (InsertedEvent, error) {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return InsertedEvent{}, err
	}
	uid, kerr := newIdempotencyKey()
	if kerr != nil {
		return InsertedEvent{}, kerr
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
		return InsertedEvent{}, fmt.Errorf("caldav insert PUT %s: %w: %w",
			url, ErrCalendarUnavailable, rerr)
	}
	if serr := caldavStatusErr(r.Status); serr != nil {
		return InsertedEvent{}, fmt.Errorf("caldav insert PUT %s status %d: %w",
			url, r.Status, serr)
	}
	return InsertedEvent{EventID: uid, HTMLLink: url}, nil
}

// DeleteEvent — DELETE the meeting's .ics (cancel).
func (c *caldavSupplier) DeleteEvent(ctx context.Context, ownerID, eventID, _ string) error {
	creds, err := c.creds(ctx, ownerID)
	if err != nil {
		return err
	}
	url := creds.URL + "/" + eventID + ".ics"
	r, rerr := caldavCall(ctx, c.doer, creds, &caldavRequest{Method: http.MethodDelete, URL: url})
	if rerr != nil {
		return ErrCalendarUnavailable
	}
	return caldavStatusErr(r.Status)
}

// creds — decrypt this owner's CalDAV config; not configured → ErrCalendarNotConnected.
func (c *caldavSupplier) creds(ctx context.Context, ownerID string) (*caldavCreds, error) {
	cfg, err := c.vault.CalDAVConfig(ctx, c.id, ownerID)
	if err != nil {
		return nil, fmt.Errorf("supplier %q caldav config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return nil, ErrCalendarNotConnected
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
		return ErrCalendarRevoked
	case caldavTransient(code):
		return ErrCalendarUnavailable
	default:
		return ErrCalendarBadRequest
	}
}

func caldavAuthErr(code int) bool {
	return code == http.StatusUnauthorized || code == http.StatusForbidden
}

func caldavTransient(code int) bool {
	return code == http.StatusTooManyRequests || code >= http.StatusInternalServerError
}
