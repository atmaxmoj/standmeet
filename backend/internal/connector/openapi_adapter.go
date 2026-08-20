// openapi_adapter.go —— 品类契约适配器：把通用 openapi 执行核（openapi.Runtime）接成消费者
// 认的品类契约（contract.CalendarProxy / MailProxy）。归一化的「最后一公里」：booker 只认
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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

// openapiCore —— 一个装配好的 openapi 连接器的公共件：id + 共享 runtime + 连接状态源 +
// 认证策略。凭据/token 经 ConnectionStore 解密给出，按 authStrategy 注入——凭据永不出本层。
type openapiCore struct {
	runtime   *openapi.Runtime
	store     ConnectionStore
	auth      authStrategy
	refresher *oauthRefresher // oauth2 静默刷新；非 oauth2 为 nil
	id        string
	expose    bool // expose_as_agent_tools：把 raw operations 暴露成 agent 工具（§3）
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

// CanPerform 在 openapi_can_perform.go —— 「这个授权做不做得了这一步」是独立的一问。

// ExposesAgentTools —— 这个连接器是否把 raw operations 暴露成 agent 工具（§3）。
func (c *openapiCore) ExposesAgentTools() bool { return c.expose }

// AgentOps —— spec 的每个 operation → 一个 agent tool 元数据（op_<id> + summary）。
func (c *openapiCore) AgentOps() []consumer.AgentOp {
	ops := c.runtime.Operations()
	out := make([]consumer.AgentOp, 0, len(ops))
	for i := range ops {
		desc := ops[i].Summary
		if desc == "" {
			desc = ops[i].Description
		}
		out = append(out, consumer.AgentOp{
			Name:        "op_" + strings.ReplaceAll(ops[i].ID, ".", "_"),
			OpID:        ops[i].ID,
			Description: desc,
		})
	}
	return out
}

// CallAgentOp —— 运行时按 operationId 直调 SaaS（注入该 owner 的 auth），回原始响应（无映射）。
func (c *openapiCore) CallAgentOp(
	ctx context.Context, ownerID, opID string, argsJSON json.RawMessage,
) (json.RawMessage, error) {
	inj, err := c.injector(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	raw, cerr := c.runtime.RawCall(ctx, opID, argsJSON, inj)
	if cerr != nil {
		return nil, fmt.Errorf("connector %q agent call: %w", c.id, cerr)
	}
	return raw, nil
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
	inj, ierr := c.auth(&conn)
	if ierr != nil {
		return nil, fmt.Errorf("connector %q auth: %w", c.id, ierr)
	}
	return inj, nil
}

// ───────────────────────── calendar 契约适配 ─────────────────────────
//
// ⚠ 契约耦合（隐式但有守护）：下面这些 input/output struct 的 **json tag 就是「契约变量名」**——
// binding（内置 builtins/data/*/binding.yaml 与 owner 上传的）的 request/response JSONata 按名引用
// 它们（如 `summary` / `visitorEmail` / `start`）。改这里的 tag = 改契约：
//   - 内置 binding 引用旧名 → JSONata 求值出 undefined → 该字段静默变空（§8-C 降级，不报错）。
//     **守护**：chat-book-success.spec 断言 booked event 的 summary/attendee/start 内容——漂移即红。
//   - 上传 binding 引用错名 → 同样降级成空，属 owner 配错，经 diag 端点自测时暴露（预期态）。
// 一句话：tag 与 binding 变量名是同一份知识，改一处务必同步另一处；e2e 内容断言是这条耦合的闸。

// calendarAdapter —— openapiCore 实现 contract.CalendarProxy。
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
	ctx context.Context, ownerID string, req contract.FreeBusyReq,
) ([]contract.BusyInterval, error) {
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
	intervals := make([]contract.BusyInterval, 0, len(out.Busy))
	for i := range out.Busy {
		b := out.Busy[i]
		intervals = append(intervals, contract.BusyInterval{Start: b.Start, End: b.End})
	}
	return intervals, nil
}

// InsertEvent —— create_event 契约方法。
func (a calendarAdapter) InsertEvent(
	ctx context.Context, ownerID string, req *contract.InsertEventReq,
) (contract.InsertedEvent, error) {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return contract.InsertedEvent{}, mapCalendarErr(err)
	}
	key, kerr := newIdempotencyKey() // 本次调用一份，重试复用 → 不重复建（D-7）
	if kerr != nil {
		return contract.InsertedEvent{}, kerr
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
		return contract.InsertedEvent{}, mapCalendarErr(cerr)
	}
	return contract.InsertedEvent{EventID: out.EventID, HTMLLink: out.HTMLLink}, nil
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
		return contract.ErrCalendarUnavailable
	}
	return fmt.Errorf("calendar: %w", err)
}

// mapCalendarSentinel —— sentinel 错映射：invalid_grant → revoked；pre-flight 缺必填 / SSRF 出站
// 被拦 → bad request（客户端/配置错，4xx，不是上游故障）。
func mapCalendarSentinel(err error) error {
	if errors.Is(err, ErrInvalidGrant) {
		return contract.ErrCalendarRevoked
	}
	if errors.Is(err, ErrBlockedEgress) { // 干净 sentinel（不回显内网 URL）
		return contract.ErrCalendarBlockedEgress
	}
	if errors.Is(err, openapi.ErrMissingRequired) {
		return fmt.Errorf("%w: %w", contract.ErrCalendarBadRequest, err)
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
		return contract.ErrCalendarUnavailable
	}
	if se.Code == http.StatusUnauthorized {
		return contract.ErrCalendarRevoked
	}
	return nil
}

// ───────────────────────── mail 契约适配 ─────────────────────────

// mailAdapter —— openapiCore 实现 contract.MailProxy。
type mailAdapter struct{ *openapiCore }

type sendInput struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html"`
}

// Send —— send 契约方法。
//
// 跟 calendarAdapter 的**刻意不对称**（不是漏写）：
//   - 不 retry：发信不幂等（无幂等键、mail provider 普遍不去重），重试瞬时错有重复发信风险；
//     宁可失败也不重发。要重试的场景（owner 通知）在 usecase 层用 notifyPolicy 包，由调用方决定。
//   - 不映射成 domain 错：mail 消费者（booking_confirmation / owner_notify / otp…）只看「发没发出」，
//     不像 booker 要按 revoked/unavailable gate，故无需 calendar 那套错误词汇（ISP：不造没人用的接口）。
func (a mailAdapter) Send(ctx context.Context, ownerID string, msg contract.MailMessage) error {
	inj, err := a.injector(ctx, ownerID)
	if err != nil {
		return err
	}
	in := sendInput{To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML}
	if cerr := a.runtime.Call(ctx, "send", in, nil, inj); cerr != nil {
		return classifyMailSendErr(cerr)
	}
	return nil
}

// classifyMailSendErr —— 把运行时的错误归到两个 mail 哨兵之一(暂时不可用 / 这封被拒)。
//
// **原始错误留在 %w 链里**给日志,面那一侧只读哨兵。归类放在这儿而不是面上:
// "429/5xx 算瞬时"是这个运行时的知识,面不该去认状态码 —— 认了就等于每加一种 kind
// 都要在面上再抄一遍判断。
func classifyMailSendErr(err error) error {
	var se *openapi.StatusError
	if errors.As(err, &se) && !se.Transient {
		return fmt.Errorf("%w: %w", contract.ErrMailRejected, err)
	}
	return fmt.Errorf("%w: %w", contract.ErrMailUnavailable, err)
}
