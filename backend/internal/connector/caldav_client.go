// caldav_client.go —— CalDAV 协议的最小但真实客户端：WebDAV REPORT（free-busy-query）查忙时、
// PUT 一份 iCalendar VEVENT 建会、DELETE 退订。protocol 连接器（caldav）的传输层；跟 SMTP 一样
// 是内置协议实现，凭据（url/user/pass）由 vault 解密给出，永不出本层。出站走 guarded client（SSRF）。

package connector

import (
	"context"
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
	icalLayout       = "20060102T150405Z"
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
		start.UTC().Format(icalLayout), end.UTC().Format(icalLayout))
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

// parseFreeBusy —— 从 VFREEBUSY 响应抽 FREEBUSY:<start>/<end> 段成忙时区间。无法解析的行跳过
// （优雅降级，不崩）。
func parseFreeBusy(body string) []busyRow {
	out := make([]busyRow, 0)
	for line := range strings.SplitSeq(body, "\n") {
		val, ok := freeBusyValue(strings.TrimSpace(line))
		if !ok {
			continue
		}
		if row, valid := parseBusyPeriod(val); valid {
			out = append(out, row)
		}
	}
	return out
}

// freeBusyValue —— 取 FREEBUSY[;params]:<value> 的 value 部分；非 FREEBUSY 行 → ok=false。
func freeBusyValue(line string) (string, bool) {
	if !strings.HasPrefix(line, "FREEBUSY") {
		return "", false
	}
	_, val, found := strings.Cut(line, ":")
	return val, found
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
