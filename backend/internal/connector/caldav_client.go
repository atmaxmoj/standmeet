// caldav_client.go — minimal but real CalDAV protocol client: WebDAV REPORT (free-busy-query)
// checks busy times, PUT an iCalendar VEVENT to create a meeting, DELETE to cancel. Transport
// layer of the protocol connector (caldav); like SMTP it's a built-in protocol implementation —
// creds (url/user/pass) come decrypted from the vault and never leave this layer. Outbound
// traffic goes through the guarded client (SSRF).

package connector

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// caldavCreds — decrypted CalDAV credentials.
type caldavCreds struct {
	URL      string
	Username string
	Password string
}

const (
	icalLayout = "20060102T150405Z"
	// icalLocalLayout — times carrying `;TZID=` have no trailing Z
	// (`DTSTART;TZID=Europe/Berlin:20260831T160000`).
	icalLocalLayout  = "20060102T150405"
	caldavReportType = "application/xml; charset=utf-8"
	caldavICalType   = "text/calendar; charset=utf-8"
	// maxCalDAVBytes — cap on outbound response body reads (guards against a runaway provider).
	maxCalDAVBytes = 4 << 20
)

// freeBusyQuery — CalDAV free-busy-query REPORT body (busy periods within a time window).
func freeBusyQuery(start, end time.Time) string {
	return fmt.Sprintf(
		`<?xml version="1.0" encoding="utf-8"?>`+
			`<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">`+
			`<C:time-range start="%s" end="%s"/></C:free-busy-query>`,
		start.UTC().Format(icalLayout), end.UTC().Format(icalLayout),
	)
}

// buildVEvent — a minimal iCalendar VEVENT (the body of the create-meeting PUT).
func buildVEvent(uid, summary string, start, end time.Time, attendee string) string {
	out := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//StandMeet//CalDAV//EN\r\nBEGIN:VEVENT\r\n"
	out += fmt.Sprintf("UID:%s\r\nSUMMARY:%s\r\nDTSTART:%s\r\nDTEND:%s\r\n",
		uid, summary, start.UTC().Format(icalLayout), end.UTC().Format(icalLayout))
	if attendee != "" {
		out += fmt.Sprintf("ATTENDEE:mailto:%s\r\n", attendee)
	}
	return out + "END:VEVENT\r\nEND:VCALENDAR\r\n"
}

// caldavRequest — one outbound CalDAV request (method includes REPORT/PROPFIND/PUT/DELETE).
type caldavRequest struct {
	Method      string
	URL         string
	Body        string
	ContentType string
}

// caldavReq — send one CalDAV request; basic auth; goes through the guarded doer. The caller
// is responsible for closing the returned body.
func caldavReq(
	ctx context.Context, doer openapi.Doer, creds *caldavCreds, r *caldavRequest,
) (*http.Response, error) {
	req, err := buildCalDAVReq(ctx, creds, r)
	if err != nil {
		return nil, err
	}
	resp, derr := doer.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("caldav %s: %w", r.Method, derr)
	}
	return resp, nil
}

func buildCalDAVReq(
	ctx context.Context, creds *caldavCreds, r *caldavRequest,
) (*http.Request, error) {
	var rdr io.Reader
	if r.Body != "" {
		rdr = strings.NewReader(r.Body)
	}
	req, err := http.NewRequestWithContext(ctx, r.Method, r.URL, rdr)
	if err != nil {
		return nil, fmt.Errorf("build caldav request: %w", err)
	}
	if r.ContentType != "" {
		req.Header.Set("Content-Type", r.ContentType)
	}
	if creds.Username != "" {
		req.SetBasicAuth(creds.Username, creds.Password)
	}
	return req, nil
}

// ErrFreeBusyUnreadable — the other side **did answer**, but we could not read any busy time out
// of its VFREEBUSY (F-C-50).
//
// **Why this error exists**: on this field, "I can't parse this answer" and "this calendar is
// empty" are **opposite** facts, and they used to share one return value (an empty slice). What
// that looked like in the real environment: the calendar had a recurring Monday meeting, the
// product told the visitor *"a clean run available … with no gaps"*, and booked the visitor right
// on top of that meeting. The correct behavior when a read fails is to say so, not to announce
// the calendar empty on the calendar's behalf ([[empty-is-not-json-null]]).
var ErrFreeBusyUnreadable = errors.New("free-busy response could not be read")

// parseFreeBusy — extract busy-time ranges from VFREEBUSY. **Accepts both real-world answer
// shapes**:
//
//	FREEBUSY[;params]:<start>/<end>       — property form (Google / Fastmail family)
//	DTSTART / DTEND on a VFREEBUSY block  — component form (Radicale family, one block per period)
//
// Zero VFREEBUSY blocks = no busy time in this window, **that is itself an answer**, return
// empty. VFREEBUSY blocks present but none of them parse = we failed to read it →
// `ErrFreeBusyUnreadable`; never treat that as empty.
func parseFreeBusy(body string) ([]busyRow, error) {
	s := freeBusyScan{out: make([]busyRow, 0)}
	for line := range strings.SplitSeq(body, "\n") {
		s.line(strings.TrimSpace(line))
	}
	if s.blocks > 0 && len(s.out) == 0 {
		return nil, ErrFreeBusyUnreadable
	}
	return s.out, nil
}

// freeBusyScan — state accumulated by scanning a VFREEBUSY response line by line.
type freeBusyScan struct {
	cur    busyBlock
	out    []busyRow
	blocks int
}

func (s *freeBusyScan) line(line string) {
	switch line {
	case "BEGIN:VFREEBUSY":
		s.blocks++
		s.cur = busyBlock{}
	case "END:VFREEBUSY":
		s.out = appendBlockRow(s.out, &s.cur)
	default:
		s.out = readFreeBusyLine(s.out, &s.cur, line)
	}
}

// busyBlock — DTSTART / DTEND accumulated line by line within one VFREEBUSY block.
type busyBlock struct {
	start time.Time
	end   time.Time
}

func (b *busyBlock) complete() bool { return !b.start.IsZero() && !b.end.IsZero() }

// readFreeBusyLine — property form becomes a row immediately; component form accumulates into
// cur first and becomes a row on END.
func readFreeBusyLine(out []busyRow, cur *busyBlock, line string) []busyRow {
	if val, ok := propValue(line, "FREEBUSY"); ok {
		if row, valid := parseBusyPeriod(val); valid {
			return append(out, row)
		}
		return out
	}
	readBlockTime(cur, line)
	return out
}

// readBlockTime — recognize DTSTART / DTEND on a VFREEBUSY block (including the `;TZID=…`
// parameter). Leaves a zero value on parse failure — `complete()` then reads false, this block
// doesn't count, and it eventually falls through to ErrFreeBusyUnreadable.
func readBlockTime(cur *busyBlock, line string) {
	if val, ok := propValue(line, "DTSTART"); ok {
		cur.start = parseICalTime(val, line)
		return
	}
	if val, ok := propValue(line, "DTEND"); ok {
		cur.end = parseICalTime(val, line)
	}
}

func appendBlockRow(out []busyRow, cur *busyBlock) []busyRow {
	if !cur.complete() {
		return out
	}
	row := busyRow{Start: cur.start, End: cur.end}
	*cur = busyBlock{}
	return append(out, row)
}

// propValue — get the value out of `NAME[;params]:<value>`; name mismatch → ok=false.
// Judged by **delimiter**, not by prefix: `DTSTAMP` also starts with `DTSTA`, so a prefix match
// would mistake it for DTSTART ([[lookahead-rule-eats-the-neighbour]]).
func propValue(line, name string) (string, bool) {
	head, val, found := strings.Cut(line, ":")
	if !found {
		return "", false
	}
	prop, _, _ := strings.Cut(head, ";")
	if prop != name {
		return "", false
	}
	return val, true
}

// parseICalTime — `20060102T150405Z` (UTC) or the Z-less local time form + `;TZID=Area/City`.
// Returns a zero value on parse failure. **Also returns a zero value when TZID isn't recognized —
// never fall back to treating it as UTC** — that would shift a meeting by hours while looking
// like success.
func parseICalTime(val, line string) time.Time {
	if t, err := time.Parse(icalLayout, val); err == nil {
		return t
	}
	loc, lerr := time.LoadLocation(tzidOf(line))
	if lerr != nil {
		return time.Time{}
	}
	t, perr := time.ParseInLocation(icalLocalLayout, val, loc)
	if perr != nil {
		return time.Time{}
	}
	return t.UTC()
}

// tzidOf — pull the zone name out of `DTSTART;TZID=Europe/Berlin:…`; empty string if absent
// (LoadLocation then fails).
func tzidOf(line string) string {
	head, _, _ := strings.Cut(line, ":")
	for part := range strings.SplitSeq(head, ";") {
		if v, ok := strings.CutPrefix(part, "TZID="); ok {
			return v
		}
	}
	return ""
}

// parseBusyPeriod — parse a "<start>/<end>" period (iCal UTC) into a busy-time range.
func parseBusyPeriod(period string) (busyRow, bool) {
	parts := strings.SplitN(period, "/", 2)
	if len(parts) != 2 {
		return busyRow{}, false
	}
	start, serr := time.Parse(icalLayout, strings.TrimSpace(parts[0]))
	end, eerr := time.Parse(icalLayout, strings.TrimSpace(parts[1]))
	if serr != nil || eerr != nil {
		return busyRow{}, false
	}
	return busyRow{Start: start, End: end}, true
}
