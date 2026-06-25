// events.go —— FreeBusy + Events.insert. See client.go for package docs.

package gcal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// ───── FreeBusy ────────────────────────────────────────────────

// BusyWindow —— RFC3339 start/end pair. Inclusive of start, exclusive of
// end (Google's contract).
type BusyWindow struct {
	Start time.Time
	End   time.Time
}

// FreeBusyInput —— inputs for the FreeBusy query. Pass by pointer to
// avoid hugeParam copy at call site.
type FreeBusyInput struct {
	TimeMin     time.Time
	TimeMax     time.Time
	AccessToken string
	TimeZone    string
	CalendarIDs []string
}

type calendarItem struct {
	ID string `json:"id"`
}

type freeBusyReqWire struct {
	TimeMin  string         `json:"timeMin"`
	TimeMax  string         `json:"timeMax"`
	TimeZone string         `json:"timeZone,omitempty"`
	Items    []calendarItem `json:"items"`
}

type busyEntryWire struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type calendarSpan struct {
	Busy []busyEntryWire `json:"busy"`
}

type freeBusyRespWire struct {
	Calendars map[string]calendarSpan `json:"calendars"`
}

// FreeBusy —— queries Google for the union of busy windows across the
// given calendars in [TimeMin, TimeMax]. Returns a flattened slice
// (caller doesn't care which calendar each busy came from — they all
// block a booking).
func (c *Client) FreeBusy(
	ctx context.Context, in *FreeBusyInput,
) ([]BusyWindow, error) {
	body, err := json.Marshal(buildFreeBusyReq(in))
	if err != nil {
		return nil, fmt.Errorf("gcal: marshal freebusy: %w", err)
	}
	resp, err := c.calendarPost(ctx, "/freeBusy", in.AccessToken, body)
	if err != nil {
		return nil, err
	}
	out, decErr := readFreeBusy(resp)
	if cerr := resp.Body.Close(); cerr != nil && decErr == nil {
		return nil, fmt.Errorf("gcal: close freebusy body: %w", cerr)
	}
	return out, decErr
}

func readFreeBusy(resp *http.Response) ([]BusyWindow, error) {
	if cerr := checkCalendarStatus(resp); cerr != nil {
		return nil, cerr
	}
	return decodeFreeBusy(resp)
}

func buildFreeBusyReq(in *FreeBusyInput) freeBusyReqWire {
	items := make([]calendarItem, 0, len(in.CalendarIDs))
	for _, id := range in.CalendarIDs {
		items = append(items, calendarItem{ID: id})
	}
	return freeBusyReqWire{
		TimeMin:  in.TimeMin.Format(time.RFC3339),
		TimeMax:  in.TimeMax.Format(time.RFC3339),
		TimeZone: in.TimeZone,
		Items:    items,
	}
}

func decodeFreeBusy(resp *http.Response) ([]BusyWindow, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes))
	if rerr != nil {
		return nil, fmt.Errorf("gcal: read freebusy body: %w", rerr)
	}
	var w freeBusyRespWire
	if uerr := json.Unmarshal(raw, &w); uerr != nil {
		return nil, fmt.Errorf("gcal: decode freebusy: %w", uerr)
	}
	return flattenBusy(w.Calendars)
}

func flattenBusy(cals map[string]calendarSpan) ([]BusyWindow, error) {
	var out []BusyWindow
	for _, cal := range cals {
		for _, b := range cal.Busy {
			win, perr := parseBusyEntry(b)
			if perr != nil {
				return nil, perr
			}
			out = append(out, win)
		}
	}
	return out, nil
}

func parseBusyEntry(b busyEntryWire) (BusyWindow, error) {
	start, serr := time.Parse(time.RFC3339, b.Start)
	if serr != nil {
		return BusyWindow{}, fmt.Errorf("gcal: parse busy start: %w", serr)
	}
	end, eerr := time.Parse(time.RFC3339, b.End)
	if eerr != nil {
		return BusyWindow{}, fmt.Errorf("gcal: parse busy end: %w", eerr)
	}
	return BusyWindow{Start: start, End: end}, nil
}

// ───── Events.insert ──────────────────────────────────────────

// EventAttendee —— invitee row passed to Events.insert.
type EventAttendee struct {
	Email string
}

// InsertEventInput —— params for Events.insert. Attendees may be empty
// (no visitor email gathered); SendUpdates controls whether Google emails
// attendees (set to "all" if visitor_email is present, "none" otherwise).
// Pass by pointer to avoid hugeParam copy.
type InsertEventInput struct {
	Start       time.Time
	End         time.Time
	AccessToken string
	CalendarID  string
	Summary     string
	Description string
	TimeZone    string
	SendUpdates string
	// IdempotencyKey —— 客户端生成的 event id（base32hex）。带它 → 重试下重复
	// insert 命中同 id 返已存事件而非新建（幂等键，杜绝瞬时错重试双订）。空 = 让
	// Google 自分配 id（无幂等保护）。
	IdempotencyKey string
	Attendees      []EventAttendee
}

// InsertedEvent —— normalized return of Events.insert. We persist EventID
// + HTMLLink in code_bookings; the rest is informational for the
// agent's tool result.
type InsertedEvent struct {
	EventID  string
	HTMLLink string
	Status   string
}

type insertWire struct {
	ID       string `json:"id"`
	HTMLLink string `json:"htmlLink"`
	Status   string `json:"status"`
}

type insertTimeWire struct {
	DateTime string `json:"dateTime"`
	TimeZone string `json:"timeZone,omitempty"`
}

type attendeeWire struct {
	Email string `json:"email"`
}

type insertReqWire struct {
	ID          string         `json:"id,omitempty"`
	Summary     string         `json:"summary"`
	Description string         `json:"description,omitempty"`
	Start       insertTimeWire `json:"start"`
	End         insertTimeWire `json:"end"`
	Attendees   []attendeeWire `json:"attendees,omitempty"`
}

// InsertEvent —— POSTs to /calendars/{calendarId}/events. Caller is
// responsible for FreeBusy + policy preflight; this just transports.
func (c *Client) InsertEvent(
	ctx context.Context, in *InsertEventInput,
) (InsertedEvent, error) {
	body, err := json.Marshal(buildInsertReq(in))
	if err != nil {
		return InsertedEvent{}, fmt.Errorf("gcal: marshal insert: %w", err)
	}
	resp, err := c.calendarPost(ctx, insertEventPath(in), in.AccessToken, body)
	if err != nil {
		return InsertedEvent{}, err
	}
	out, decErr := readInsert(resp)
	if cerr := resp.Body.Close(); cerr != nil && decErr == nil {
		return InsertedEvent{}, fmt.Errorf("gcal: close insert body: %w", cerr)
	}
	return out, decErr
}

func insertEventPath(in *InsertEventInput) string {
	path := "/calendars/" + url.PathEscape(in.CalendarID) + "/events"
	if in.SendUpdates != "" {
		path += "?sendUpdates=" + url.QueryEscape(in.SendUpdates)
	}
	return path
}

func readInsert(resp *http.Response) (InsertedEvent, error) {
	if cerr := checkCalendarStatus(resp); cerr != nil {
		return InsertedEvent{}, cerr
	}
	return decodeInsert(resp)
}

// rfc3339Millis —— RFC3339 with 3-digit fractional seconds (matches
// JavaScript Date.toISOString() output). Google accepts both forms.
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

func buildInsertReq(in *InsertEventInput) insertReqWire {
	atts := make([]attendeeWire, 0, len(in.Attendees))
	for _, a := range in.Attendees {
		atts = append(atts, attendeeWire(a))
	}
	return insertReqWire{
		ID:          in.IdempotencyKey,
		Summary:     in.Summary,
		Description: in.Description,
		Start: insertTimeWire{
			DateTime: in.Start.UTC().Format(rfc3339Millis), TimeZone: in.TimeZone,
		},
		End: insertTimeWire{
			DateTime: in.End.UTC().Format(rfc3339Millis), TimeZone: in.TimeZone,
		},
		Attendees: atts,
	}
}

func decodeInsert(resp *http.Response) (InsertedEvent, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes))
	if rerr != nil {
		return InsertedEvent{}, fmt.Errorf("gcal: read insert body: %w", rerr)
	}
	var w insertWire
	if uerr := json.Unmarshal(raw, &w); uerr != nil {
		return InsertedEvent{}, fmt.Errorf("gcal: decode insert: %w", uerr)
	}
	return InsertedEvent{EventID: w.ID, HTMLLink: w.HTMLLink, Status: w.Status}, nil
}

// Events.delete 拆到 events_delete.go 守 max-public-structs=5。
