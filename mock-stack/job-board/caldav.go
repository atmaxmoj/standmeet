// caldav.go —— CalDAV server mock (#155 §8 provider-agnostic: a calendar-protocol
// connector for non-Google calendars).
// One collection per connector, /caldav/{coll}: REPORT queries busy times (VFREEBUSY),
// PUT .ics books an event, DELETE cancels, PROPFIND is a connectivity check. The control
// plane /__mock/caldav/{coll}/{events,fail,reset,set_busy} mirrors the gcal mock's shape.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// caldavState —— state for every collection (events / busy / fault injection), keyed by coll id.
type caldavState struct {
	colls map[string]*caldavColl
	mu    sync.Mutex
}

type caldavColl struct {
	events []caldavEvent
	busy   []busyWindow
	// busyStyle —— which shape free-busy-query replies with (see busyStyleComponent).
	// Empty = the FREEBUSY property.
	busyStyle string
	fails     map[string]int // op("create_event"/"list_busy"/"cancel_event") → the status to return (one-shot)
}

// busyStyleComponent —— **the other way a real server answers**: one `VFREEBUSY`
// component per busy window, times on `DTSTART` / `DTEND`, not a single `FREEBUSY:`
// line. That's how Radicale replies.
//
// This stand-in used to know only the `FREEBUSY:<start>/<end>` form, and the
// product's parser only understood that same form — so "parsed zero busy windows"
// could never happen here and was never caught (F-C-50: in the real environment,
// the product told a visitor "this whole day is wide open" while the calendar had
// a weekly recurring meeting on it).
// [[stand-in-is-politer-than-reality]]: teach the stand-in to answer the way the
// real world does, first.
const busyStyleComponent = "component"

// caldavEvent —— one recorded event (normalized fields, for test assertions).
type caldavEvent struct {
	Summary   string   `json:"summary"`
	Start     string   `json:"start"`
	End       string   `json:"end"`
	Attendees []string `json:"attendees"`
}

const caldavICalLayout = "20060102T150405Z"

func (s *server) withCalDAV(coll string, f func(*caldavColl)) {
	s.caldav.mu.Lock()
	defer s.caldav.mu.Unlock()
	if s.caldav.colls == nil {
		s.caldav.colls = map[string]*caldavColl{}
	}
	c, ok := s.caldav.colls[coll]
	if !ok {
		c = &caldavColl{fails: map[string]int{}}
		s.caldav.colls[coll] = c
	}
	f(c)
}

// takeCalDAVFail —— the injected status this op should return this time (0 = no
// injection); cleared once consumed (one-shot). Caller holds the lock.
func (c *caldavColl) takeFail(op string) int {
	status := c.fails[op]
	if status != 0 {
		delete(c.fails, op)
	}
	return status
}

// serveCalDAVReport —— free-busy-query REPORT: reply with VFREEBUSY (from coll.busy).
func (s *server) serveCalDAVReport(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	var fail int
	var busy []busyWindow
	var style string
	s.withCalDAV(coll, func(c *caldavColl) {
		fail = c.takeFail("list_busy")
		busy = append(busy, c.busy...)
		style = c.busyStyle
	})
	if fail != 0 {
		http.Error(w, "injected", fail)
		return
	}
	w.Header().Set("Content-Type", "text/calendar")
	if _, err := io.WriteString(w, freeBusyBody(busy, style)); err != nil {
		s.log.Warn("write caldav report", logErrKey, err)
	}
}

// freeBusyBody —— two real reply forms. The `component` form is one VFREEBUSY per
// window with times on DTSTART/DTEND (Radicale); the default form is the FREEBUSY
// property (Google/Fastmail family).
func freeBusyBody(busy []busyWindow, style string) string {
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\n")
	for i := range busy {
		if style == busyStyleComponent {
			fmt.Fprintf(&b,
				"BEGIN:VFREEBUSY\r\nDTSTART:%s\r\nDTEND:%s\r\nFBTYPE:BUSY\r\nEND:VFREEBUSY\r\n",
				busy[i].Start, busy[i].End)
			continue
		}
		fmt.Fprintf(&b, "BEGIN:VFREEBUSY\r\nFREEBUSY:%s/%s\r\nEND:VFREEBUSY\r\n",
			busy[i].Start, busy[i].End)
	}
	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}

// serveCalDAVPut —— PUT <coll>/<uid>.ics: parse the VEVENT and record the event
// (includes create_event fault injection).
func (s *server) serveCalDAVPut(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	ev := parseVEvent(string(body))
	var fail int
	s.withCalDAV(coll, func(c *caldavColl) {
		if fail = c.takeFail("create_event"); fail == 0 {
			c.events = append(c.events, ev)
		}
	})
	if fail != 0 {
		http.Error(w, "injected", fail)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

// serveCalDAVDelete —— DELETE <coll>/<uid>.ics: cancel (includes cancel_event fault injection).
func (s *server) serveCalDAVDelete(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	var fail int
	s.withCalDAV(coll, func(c *caldavColl) { fail = c.takeFail("cancel_event") })
	if fail != 0 {
		http.Error(w, "injected", fail)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// serveCalDAVPropfind —— connectivity probe: always 207 (the CalDAV multistatus convention).
func (s *server) serveCalDAVPropfind(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusMultiStatus)
}

// parseVEvent —— extract SUMMARY/DTSTART/DTEND/ATTENDEE from an iCalendar VEVENT
// (normalized to RFC3339 millis).
func parseVEvent(body string) caldavEvent {
	var ev caldavEvent
	for line := range strings.SplitSeq(body, "\n") {
		key, val, found := strings.Cut(strings.TrimSpace(line), ":")
		if !found {
			continue
		}
		applyVEventField(&ev, key, val)
	}
	return ev
}

func applyVEventField(ev *caldavEvent, key, val string) {
	switch key {
	case "SUMMARY":
		ev.Summary = val
	case "DTSTART":
		ev.Start = icalToRFC3339(val)
	case "DTEND":
		ev.End = icalToRFC3339(val)
	case "ATTENDEE":
		ev.Attendees = append(ev.Attendees, strings.TrimPrefix(val, "mailto:"))
	}
}

func icalToRFC3339(v string) string {
	t, err := time.Parse(caldavICalLayout, strings.TrimSpace(v))
	if err != nil {
		return v
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

type caldavEventsResp struct {
	Events []caldavEvent `json:"events"`
}

// serveCalDAVEvents —— read every recorded event in a collection (test asserts
// that booker lands on a non-Google provider).
func (s *server) serveCalDAVEvents(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	var resp caldavEventsResp
	s.withCalDAV(coll, func(c *caldavColl) {
		resp.Events = append([]caldavEvent{}, c.events...)
	})
	w.Header().Set("Content-Type", jsonMIME)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		s.log.Warn("write caldav events", logErrKey, err)
	}
}

type caldavFailReq struct {
	Op     string `json:"op"`
	Status int    `json:"status"`
}

// serveCalDAVFail —— arm an op to return a given status next time (default 503).
func (s *server) serveCalDAVFail(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req caldavFailReq
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.Status == 0 {
		req.Status = http.StatusServiceUnavailable
	}
	s.withCalDAV(coll, func(c *caldavColl) { c.fails[req.Op] = req.Status })
	writeOK(s.log, w)
}

type caldavSetBusyReq struct {
	Busy []busyWindow `json:"busy"`
	// Style —— which shape to reply with for busy windows (see busyStyleComponent).
	// Empty = the old default.
	Style string `json:"style"`
}

// serveCalDAVSetBusy —— set a collection's busy windows (free-busy-query replies with these).
func (s *server) serveCalDAVSetBusy(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req caldavSetBusyReq
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.withCalDAV(coll, func(c *caldavColl) { c.busy = req.Busy; c.busyStyle = req.Style })
	writeOK(s.log, w)
}

// serveCalDAVReset —— clear a collection's events + busy windows + fault injection.
func (s *server) serveCalDAVReset(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	s.withCalDAV(coll, func(c *caldavColl) {
		c.events = nil
		c.busy = nil
		c.fails = map[string]int{}
	})
	writeOK(s.log, w)
}
