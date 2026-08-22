// caldav_client.go —— CalDAV 协议的最小但真实客户端：WebDAV REPORT（free-busy-query）查忙时、
// PUT 一份 iCalendar VEVENT 建会、DELETE 退订。protocol 连接器（caldav）的传输层；跟 SMTP 一样
// 是内置协议实现，凭据（url/user/pass）由 vault 解密给出，永不出本层。出站走 guarded client（SSRF）。

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

// caldavCreds —— 解密后的 CalDAV 凭据。
type caldavCreds struct {
	URL      string
	Username string
	Password string
}

const (
	icalLayout = "20060102T150405Z"
	// icalLocalLayout —— 带 `;TZID=` 的时间没有末尾那个 Z（`DTSTART;TZID=Europe/Berlin:20260831T160000`）。
	icalLocalLayout  = "20060102T150405"
	caldavReportType = "application/xml; charset=utf-8"
	caldavICalType   = "text/calendar; charset=utf-8"
	maxCalDAVBytes   = 4 << 20 // 出站响应体读取上限（防失控 provider）
)

// freeBusyQuery —— CalDAV free-busy-query REPORT body（时间窗内的忙时段）。
func freeBusyQuery(start, end time.Time) string {
	return fmt.Sprintf(
		`<?xml version="1.0" encoding="utf-8"?>`+
			`<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">`+
			`<C:time-range start="%s" end="%s"/></C:free-busy-query>`,
		start.UTC().Format(icalLayout), end.UTC().Format(icalLayout),
	)
}

// buildVEvent —— 一份最小 iCalendar VEVENT（建会 PUT 的 body）。
func buildVEvent(uid, summary string, start, end time.Time, attendee string) string {
	out := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//StandMeet//CalDAV//EN\r\nBEGIN:VEVENT\r\n"
	out += fmt.Sprintf("UID:%s\r\nSUMMARY:%s\r\nDTSTART:%s\r\nDTEND:%s\r\n",
		uid, summary, start.UTC().Format(icalLayout), end.UTC().Format(icalLayout))
	if attendee != "" {
		out += fmt.Sprintf("ATTENDEE:mailto:%s\r\n", attendee)
	}
	return out + "END:VEVENT\r\nEND:VCALENDAR\r\n"
}

// caldavRequest —— 一个 CalDAV 出站请求（method 含 REPORT/PROPFIND/PUT/DELETE）。
type caldavRequest struct {
	Method      string
	URL         string
	Body        string
	ContentType string
}

// caldavReq —— 发一个 CalDAV 请求；basic auth；走 guarded doer。调用方负责关闭返回的 body。
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

// ErrFreeBusyUnreadable —— 对面**答了**，而我们没能从它的 VFREEBUSY 里读出任何忙时（F-C-50）。
//
// **这条错误存在的理由**：这个字段上「我看不懂这个回答」和「这个日历是空的」是**相反**的两件事，
// 而以前它们是同一个返回值（空切片）。真环境上的样子是：日历上有一场每周一的会，产品对访客说
// *"a clean run available … with no gaps"*，然后把访客约在那场会上面。
// 读不出来时正确的行为是说不出来，不是替日历宣布它空着（[[empty-is-not-json-null]]）。
var ErrFreeBusyUnreadable = errors.New("free-busy response could not be read")

// parseFreeBusy —— 从 VFREEBUSY 抽忙时区间。**两种真实答法都认**：
//
//	FREEBUSY[;params]:<start>/<end>       —— 属性形式（Google / Fastmail 一族）
//	VFREEBUSY 组件上的 DTSTART / DTEND    —— 组件形式（Radicale 一族，一段一个组件）
//
// 一个 VFREEBUSY 都没有 = 这段窗口里没有忙时，**那是一个答案**，返回空。
// 有 VFREEBUSY 却一段都读不出来 = 我们没读懂 → `ErrFreeBusyUnreadable`，不许当成空。
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

// freeBusyScan —— 逐行扫一份 VFREEBUSY 响应攒出来的状态。
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

// busyBlock —— 一个 VFREEBUSY 组件里逐行攒起来的 DTSTART / DTEND。
type busyBlock struct {
	start time.Time
	end   time.Time
}

func (b *busyBlock) complete() bool { return !b.start.IsZero() && !b.end.IsZero() }

// readFreeBusyLine —— 属性形式当场成段；组件形式先攒进 cur，等 END 再成段。
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

// readBlockTime —— 认 VFREEBUSY 组件上的 DTSTART / DTEND（含 `;TZID=…` 参数）。
// 读不出来就留零值 —— `complete()` 因此判假，这一段不成立，最终落到 ErrFreeBusyUnreadable。
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

// propValue —— 取 `NAME[;params]:<value>` 的 value；名字对不上 → ok=false。
// 按**分隔符**判而不是按前缀判：`DTSTAMP` 也以 `DTSTA` 开头，前缀匹配会把它当成 DTSTART
// （[[lookahead-rule-eats-the-neighbour]]）。
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

// parseICalTime —— `20060102T150405Z`（UTC）或不带 Z 的本地时间 + `;TZID=Area/City`。
// 读不出来返回零值。**TZID 认不出来时也返回零值，不许退回当成 UTC** —— 那会把一场会
// 挪几个小时，而它长得像成功。
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

// tzidOf —— 从 `DTSTART;TZID=Europe/Berlin:…` 里取出时区名；没有则空串（LoadLocation 会失败）。
func tzidOf(line string) string {
	head, _, _ := strings.Cut(line, ":")
	for part := range strings.SplitSeq(head, ";") {
		if v, ok := strings.CutPrefix(part, "TZID="); ok {
			return v
		}
	}
	return ""
}

// parseBusyPeriod —— 解析一个 "<start>/<end>" period（iCal UTC）成忙时区间。
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
