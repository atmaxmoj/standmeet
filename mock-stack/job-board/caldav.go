// caldav.go —— CalDAV server mock（#155 §8 provider-agnostic：非 Google 日历 protocol 连接器）。
// 每个连接器一个 collection /caldav/{coll}：REPORT 查忙时（VFREEBUSY）、PUT .ics 建会、DELETE 退订、
// PROPFIND 连通性。控制面 /__mock/caldav/{coll}/{events,fail,reset,set_busy} 跟 gcal mock 同构。

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

// caldavState —— 所有 collection 的状态（events / busy / 失败注入），按 coll id 分。
type caldavState struct {
	colls map[string]*caldavColl
	mu    sync.Mutex
}

type caldavColl struct {
	events []caldavEvent
	busy   []busyWindow
	// busyStyle —— free-busy-query 回哪一种形状（见 busyStyleComponent）。空 = FREEBUSY 属性。
	busyStyle string
	fails     map[string]int // op("create_event"/"list_busy"/"cancel_event") → 返回的 status（一次性）
}

// busyStyleComponent —— **真服务器的另一种答法**：一段忙时一个 `VFREEBUSY` 组件，
// 时间写在 `DTSTART` / `DTEND` 上，一行 `FREEBUSY:` 都没有。Radicale 就是这么回的。
//
// 这个替身以前只会 `FREEBUSY:<start>/<end>` 那一种，而产品的解析器也只认那一种 ——
// 于是「解析出零条忙时」在这里永远发生不了，测不到（F-C-50：真环境上产品因此
// 对访客说「这天连着一整天没有空档」，而日历上有一场每周一的会）。
// [[stand-in-is-politer-than-reality]]：先教替身按真世界的样子答话。
const busyStyleComponent = "component"

// caldavEvent —— 录到的一个会（归一字段，供测试断言）。
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

// takeCalDAVFail —— op 这次该返的注入 status（0 = 不注入）；命中即清（一次性）。调用方持锁。
func (c *caldavColl) takeFail(op string) int {
	status := c.fails[op]
	if status != 0 {
		delete(c.fails, op)
	}
	return status
}

// serveCalDAVReport —— free-busy-query REPORT：回 VFREEBUSY（从 coll.busy）。
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

// freeBusyBody —— 两种真实答法。`component` 那一种一段一个 VFREEBUSY、时间在 DTSTART/DTEND 上
// （Radicale）；默认那一种是 FREEBUSY 属性（Google/Fastmail 一族）。
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

// serveCalDAVPut —— PUT <coll>/<uid>.ics：解析 VEVENT 录会（含 create_event 失败注入）。
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

// serveCalDAVDelete —— DELETE <coll>/<uid>.ics：退订（含 cancel_event 失败注入）。
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

// serveCalDAVPropfind —— 连通性探测：恒 207（CalDAV multistatus 习惯）。
func (s *server) serveCalDAVPropfind(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusMultiStatus)
}

// parseVEvent —— 从 iCalendar VEVENT 抽 SUMMARY/DTSTART/DTEND/ATTENDEE（归一成 RFC3339 millis）。
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

// serveCalDAVEvents —— 读某 collection 录到的所有会（测试断 booker 落到非 Google provider）。
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

// serveCalDAVFail —— 武装某 op 下一次返指定 status（默认 503）。
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
	// Style —— 忙时用哪一种形状回（见 busyStyleComponent）。空 = 老样子。
	Style string `json:"style"`
}

// serveCalDAVSetBusy —— 设某 collection 的忙时段（free-busy-query 回这些）。
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

// serveCalDAVReset —— 清空某 collection 的会 + 忙时 + 失败注入。
func (s *server) serveCalDAVReset(w http.ResponseWriter, r *http.Request) {
	coll := r.PathValue("coll")
	s.withCalDAV(coll, func(c *caldavColl) {
		c.events = nil
		c.busy = nil
		c.fails = map[string]int{}
	})
	writeOK(s.log, w)
}
