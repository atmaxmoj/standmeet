// openapi_adapter.go —— 品类契约适配器：把通用 openapi 执行核（openapi.Runtime）接成消费者
// 认的品类契约（usecases.CalendarProxy / MailProxy）。归一化的「最后一公里」：booker 只认
// CalendarProxy，背后是 Google / Outlook / 任意贴了 spec+binding 的 SaaS，一概不知。
//
// 一个连接器服务多 owner：runtime（spec+binding）共享，认证 + 连接状态按 (连接器,owner) 经
// AuthManager 解出（凭据/OAuth token 全在它内部，永不出 connector）。openapiCore 管 Name/
// Connected/call 这些公共件；calendarAdapter / mailAdapter 各加自己那套 typed 契约方法 +
// 错误映射（calendar→domain.ErrCalendar* / mail→usecases.ErrMail*）。

package connector

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/retry"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// openapiCore —— 一个装配好的 openapi 连接器的公共件：id + 共享 runtime + 连接状态源 +
// 认证策略。凭据/token 经 ConnectionStore 解密给出，按 authStrategy 注入——凭据永不出本层。
type openapiCore struct {
	runtime   *openapi.Runtime
	store     ConnectionStore
	auth      authStrategy
	refresher *oauthRefresher // oauth2 静默刷新；非 oauth2 为 nil
	id        string
}

// Name —— Connector 基面：连接器名。
func (c *openapiCore) Name() string { return c.id }

// Kind —— openapi 执行核固定 kind=openapi（消费者经此知道底下走 HTTP spec+binding）。
func (*openapiCore) Kind() string { return "openapi" }

// Connected —— Connector 基面：这个 owner 连没连（读连接状态）。
func (c *openapiCore) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := c.store.Get(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return conn.Connected, nil
}

// injector —— 读该 owner 的连接状态，按 authStrategy 解出注入器（凭据全在本层内解密注入）。
func (c *openapiCore) injector(ctx context.Context, ownerID string) (openapi.AuthInjector, error) {
	conn, err := c.store.Get(ctx, c.id, ownerID)
	if err != nil {
		return nil, fmt.Errorf("connector %q load: %w", c.id, err)
	}
	if c.refresher != nil {
		if rerr := c.refresher.maybeRefresh(ctx, c.id, ownerID, &conn); rerr != nil {
			return nil, fmt.Errorf("connector %q refresh: %w", c.id, rerr)
		}
	}
	inj, ierr := c.auth.inject(&conn)
	if ierr != nil {
		return nil, fmt.Errorf("connector %q auth: %w", c.id, ierr)
	}
	return inj, nil
}

// ───────────────────────── calendar 契约适配 ─────────────────────────

// calendarAdapter —— openapiCore 实现 usecases.CalendarProxy。
type calendarAdapter struct{ *openapiCore }

type listBusyInput struct {
	TimeMin time.Time `json:"timeMin"`
	TimeMax time.Time `json:"timeMax"`
}

type busyRow struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

type busyResult struct {
	Busy []busyRow `json:"busy"`
}

// rfc3339Millis —— 事件时间带毫秒发出（Go 默认 RFC3339Nano 会裁掉 .000 尾零，
// 丢精度；显式毫秒让预约时间忠实 round-trip 进日历）。
const rfc3339Millis = "2006-01-02T15:04:05.000Z07:00"

const idempotencyKeyBytes = 16

// newIdempotencyKey —— 一次写操作的幂等键（随机 16B hex）。本次 InsertEvent 调用生成一份，
// 重试整段复用，外部按它去重 → 网络抖动重试不双建。
func newIdempotencyKey() (string, error) {
	buf := make([]byte, idempotencyKeyBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("gen idempotency key: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

type insertEventInput struct {
	Summary        string `json:"summary"`
	Description    string `json:"description"`
	Start          string `json:"start"`
	End            string `json:"end"`
	TimeZone       string `json:"timeZone"`
	VisitorEmail   string `json:"visitorEmail"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type insertedResult struct {
	EventID  string `json:"id"`
	HTMLLink string `json:"htmlLink"`
}

type cancelInput struct {
	EventID       string `json:"eventId"`
	AttendeeEmail string `json:"attendeeEmail"`
}

// FreeBusy —— list_busy 契约方法。
func (a calendarAdapter) FreeBusy(
	ctx context.Context, ownerID string, req usecases.FreeBusyReq,
) ([]usecases.BusyInterval, error) {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return nil, mapCalendarErr(err)
	}
	var out busyResult
	in := listBusyInput{TimeMin: req.TimeMin, TimeMax: req.TimeMax}
	if cerr := retry.Do(ctx, calendarReadPolicy(), func() error {
		return a.runtime.Call(ctx, "list_busy", in, &out, inj)
	}); cerr != nil {
		return nil, mapCalendarErr(cerr)
	}
	intervals := make([]usecases.BusyInterval, 0, len(out.Busy))
	for i := range out.Busy {
		b := out.Busy[i]
		intervals = append(intervals, usecases.BusyInterval{Start: b.Start, End: b.End})
	}
	return intervals, nil
}

// InsertEvent —— create_event 契约方法。
func (a calendarAdapter) InsertEvent(
	ctx context.Context, ownerID string, req *usecases.InsertEventReq,
) (usecases.InsertedEvent, error) {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return usecases.InsertedEvent{}, mapCalendarErr(err)
	}
	key, kerr := newIdempotencyKey() // 本次调用一份，重试复用 → 不重复建（D-7）
	if kerr != nil {
		return usecases.InsertedEvent{}, kerr
	}
	in := insertEventInput{
		Summary: req.Summary, Description: req.Description,
		Start:    req.Start.Format(rfc3339Millis),
		End:      req.End.Format(rfc3339Millis),
		TimeZone: req.TimeZone, VisitorEmail: req.VisitorEmail,
		IdempotencyKey: key,
	}
	var out insertedResult
	if cerr := retry.Do(ctx, calendarWritePolicy(), func() error {
		return a.runtime.Call(ctx, "create_event", in, &out, inj)
	}); cerr != nil {
		return usecases.InsertedEvent{}, mapCalendarErr(cerr)
	}
	return usecases.InsertedEvent{EventID: out.EventID, HTMLLink: out.HTMLLink}, nil
}

// DeleteEvent —— cancel_event 契约方法。
func (a calendarAdapter) DeleteEvent(
	ctx context.Context, ownerID, eventID, attendeeEmail string,
) error {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return mapCalendarErr(err)
	}
	in := cancelInput{EventID: eventID, AttendeeEmail: attendeeEmail}
	if cerr := retry.Do(ctx, calendarWritePolicy(), func() error {
		return a.runtime.Call(ctx, "cancel_event", in, nil, inj)
	}); cerr != nil {
		return mapCalendarErr(cerr)
	}
	return nil
}

// mapCalendarErr —— 把执行核错映射成 calendar 域错（友好降级）。invalid_grant/401 → revoked；
// 429/5xx/网络抖动 → 「稍后再试」；其余 → 包一层。
func mapCalendarErr(err error) error {
	if err == nil {
		return nil
	}
	if d := mapCalendarSentinel(err); d != nil {
		return d
	}
	if mapped := mapStatusErr(err); mapped != nil {
		return mapped
	}
	if openapiTransient(err) {
		return domain.ErrCalendarUnavailable
	}
	return fmt.Errorf("calendar: %w", err)
}

// mapCalendarSentinel —— sentinel 错映射：invalid_grant → revoked；pre-flight 缺必填 → bad request。
func mapCalendarSentinel(err error) error {
	if errors.Is(err, ErrInvalidGrant) {
		return domain.ErrCalendarRevoked
	}
	if errors.Is(err, openapi.ErrMissingRequired) {
		return fmt.Errorf("%w: %w", domain.ErrCalendarBadRequest, err)
	}
	return nil
}

// mapStatusErr —— StatusError 专项映射（transient → unavailable；401 → revoked）；非 StatusError → nil。
func mapStatusErr(err error) error {
	var se *openapi.StatusError
	if !errors.As(err, &se) {
		return nil
	}
	if se.Transient {
		return domain.ErrCalendarUnavailable
	}
	if se.Code == http.StatusUnauthorized {
		return domain.ErrCalendarRevoked
	}
	return nil
}

// ───────────────────────── mail 契约适配 ─────────────────────────

// mailAdapter —— openapiCore 实现 usecases.MailProxy。
type mailAdapter struct{ *openapiCore }

type sendInput struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"`
}

// Send —— send 契约方法。
func (a mailAdapter) Send(ctx context.Context, ownerID string, msg usecases.MailMessage) error {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return err
	}
	in := sendInput{To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML}
	if cerr := a.runtime.Call(ctx, "send", in, nil, inj); cerr != nil {
		return fmt.Errorf("mail: %w", cerr)
	}
	return nil
}
