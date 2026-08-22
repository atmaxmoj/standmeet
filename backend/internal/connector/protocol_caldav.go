// protocol_caldav.go —— protocol kind 的 CalDAV 连接器：通用协议（任意 CalDAV server：Fastmail/
// Apple/Nextcloud…）实现 calendar 品类契约（contract.CalendarProxy）。跟 openapi 适配器、SMTP
// 连接器并列——三者都到同一个 CalendarProxy 契约，消费者（booker）一概不知背后是 HTTP API 还是
// CalDAV 还是 Google。凭据（url/user/pass）由 CalDAVVault 按 (连接器,owner) 解密给出，永不出本层。

package connector

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// CalDAVConfig —— 一个 CalDAV 连接器的解密后配置。
type CalDAVConfig struct {
	URL      string
	Username string
	Password string
}

// Configured —— 是否填了能连的最低配置（有 collection URL）。
func (c *CalDAVConfig) Configured() bool { return c.URL != "" }

// CalDAVVault —— protocol(caldav) 连接器的连接源：连接状态 + 解密后配置。
type CalDAVVault interface {
	Connected(ctx context.Context, connectorID, ownerID string) (bool, error)
	CalDAVConfig(ctx context.Context, connectorID, ownerID string) (CalDAVConfig, error)
}

// caldavConnector —— 实现 Connector 基面 + Verifier + contract.CalendarProxy。
type caldavConnector struct {
	vault CalDAVVault
	doer  openapi.Doer
	id    string
}

// NewCalDAVConnector —— 装配一个 CalDAV protocol 连接器（doer = SSRF-guarded 出站客户端）。
func NewCalDAVConnector(id string, vault CalDAVVault, doer openapi.Doer) Connector {
	return &caldavConnector{vault: vault, doer: doer, id: id}
}

// Name —— Connector 基面。
func (c *caldavConnector) Name() string { return c.id }

// Kind —— protocol 连接器固定 kind=protocol。
func (*caldavConnector) Kind() string { return "protocol" }

// Connected —— 这个 owner 连没连。
func (c *caldavConnector) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return conn, nil
}

// Verify —— 连接测试：对 collection 发一次 PROPFIND（不写）。configured 缺 / 不可达 → 错。
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

// FreeBusy —— CalDAV free-busy-query REPORT → 归一忙时区间。
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

// busyIntervals —— 把一份 free-busy 响应翻成契约的忙时区间。
// **读不出来 → 报错，不是「没有忙时」**（F-C-50）：上层据此说「查不到你的日历」，
// 而不是把整天当空的排出去。
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

// InsertEvent —— PUT 一份 iCalendar VEVENT 建会（UID 幂等：重试同 UID 不双订）。
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
		// 保留真实 cause（dial / SSRF / 传输错）——上层 marshalBookErr server-side 记，访客仍映友好
		// 「稍后再试」。此前直接吞成 ErrCalendarUnavailable，运维查无可查（fail-loud）。
		return contract.InsertedEvent{}, fmt.Errorf("caldav insert PUT %s: %w: %w",
			url, contract.ErrCalendarUnavailable, rerr)
	}
	if serr := caldavStatusErr(r.Status); serr != nil {
		return contract.InsertedEvent{}, fmt.Errorf("caldav insert PUT %s status %d: %w",
			url, r.Status, serr)
	}
	return contract.InsertedEvent{EventID: uid, HTMLLink: url}, nil
}

// DeleteEvent —— DELETE 该会的 .ics（退订）。
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

// creds —— 解密该 owner 的 CalDAV 配置；未配 → ErrCalendarNotConnected。
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

// caldavResp —— 一次 CalDAV 调用的结果（body + 状态码；function-result-limit ≤2 用结构体）。
type caldavResp struct {
	Body   string
	Status int
}

// caldavCall —— 发请求 + 读体 + 关体（读错优先、关错次之）。网络错冒出来由调用方映射降级。
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

// caldavStatusErr —— 状态码 → calendar 域错（401/403 → revoked；429/5xx → unavailable；其余 4xx
// → bad request）。2xx/3xx → nil。
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
