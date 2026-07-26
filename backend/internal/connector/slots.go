// slots.go —— 品类槽位分派：把「品类契约」分派到该 owner 当前 active 的连接器（§9 槽位规则）。
// Hub 持装配好的连接器（按 connector_id），SlotStore 解析哪个是 owner 某品类的 active；消费者
// （booker / mailer）只认 contract.CalendarProxy / MailProxy，不知背后是哪个 provider、哪 kind。
// 这是底座（Hub + 分派）与具体连接器之间的最后一环——主后端只见品类契约，没有任何 specific connector。

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

// errNoActiveConnector —— owner 该品类没有 active 连接器（或它已不在 Hub）。内部 sentinel：
// 分派器把它翻成各品类的「未连接」域错（gate 掉，不当真错）。
var errNoActiveConnector = errors.New("no active connector for category")

// SlotStore —— 解析某 owner 某品类的 active 连接器 id（§9）。空串 = 无 active。composition root
// 从 ConnectorRepo 接线（同品类同时只一个 active）。
type SlotStore interface {
	ActiveConnectorID(ctx context.Context, ownerID, category string) (string, error)
}

// Slots —— 品类契约 → active 连接器的分派器。
type Slots struct {
	hub   *Hub
	store SlotStore
}

// NewSlots —— composition root 注入 Hub + active 解析。
func NewSlots(hub *Hub, store SlotStore) *Slots { return &Slots{hub: hub, store: store} }

// Register —— 把一个（运行时装配好的上传）连接器注册进 Hub（幂等）。POST /connectors 用。
func (s *Slots) Register(c Connector) { s.hub.Upsert(c) }

// ConnectorCalendar —— 按 id 取一个连接器的 CalendarProxy（diag：直接打某个连接器，不经 active 槽）。
// （Resolve+断言这条模式本想用泛型 resolveAs[T] 收口，但 Go 无泛型方法、方法接口又不能 union 进
// 约束，唯一可行的 [T any] 被业务层 forbidigo 禁；几行内联断言比 ban 掉的构造更直白，留着。）
func (s *Slots) ConnectorCalendar(id string) (contract.CalendarProxy, bool) {
	c, ok := s.hub.Resolve(id)
	if !ok {
		return nil, false
	}
	cal, isCal := c.(contract.CalendarProxy)
	return cal, isCal
}

// ConnectorMail —— 按 id 取一个连接器的 MailProxy（diag：直接打某个连接器，不经 active 槽）。
func (s *Slots) ConnectorMail(id string) (contract.MailProxy, bool) {
	c, ok := s.hub.Resolve(id)
	if !ok {
		return nil, false
	}
	m, isMail := c.(contract.MailProxy)
	return m, isMail
}

// AgentConnectorsByID —— 给一组 connector id，挑出实现 AgentToolConnector 且开了 expose 的那些
// （§3：openapi 把 raw ops 暴露成 agent 工具）。返回切片（非裸接口），per-session 源用。
func (s *Slots) AgentConnectorsByID(ids []string) []consumer.AgentToolConnector {
	out := make([]consumer.AgentToolConnector, 0, len(ids))
	for _, id := range ids {
		c, ok := s.hub.Resolve(id)
		if !ok {
			continue
		}
		if atc, isAgent := c.(consumer.AgentToolConnector); isAgent && atc.ExposesAgentTools() {
			out = append(out, atc)
		}
	}
	return out
}

// AgentCall —— diag/agent-call：按 id 解析连接器、跑一个 op（注入 auth 调 SaaS），回原始响应。
// 未注册 / 非 agent 连接器 → errNoActiveConnector（diag 翻 404）。不回裸接口。
func (s *Slots) AgentCall(
	ctx context.Context, id, ownerID, opID string, args json.RawMessage,
) (json.RawMessage, error) {
	c, ok := s.hub.Resolve(id)
	if !ok {
		return nil, fmt.Errorf("agent call %q: %w", id, errNoActiveConnector)
	}
	atc, isAgent := c.(consumer.AgentToolConnector)
	if !isAgent {
		return nil, fmt.Errorf("agent call %q: %w", id, errNoActiveConnector)
	}
	raw, err := atc.CallAgentOp(ctx, ownerID, opID, args)
	if err != nil {
		return nil, fmt.Errorf("agent call %q: %w", id, err)
	}
	return raw, nil
}

// MailKind —— active mail 连接器的 kind（openapi/protocol）；无 active → 空串。消费者（test-send）
// 借此报 via_kind，证「mailer 不挑 kind」。
func (s *Slots) MailKind(ctx context.Context, ownerID string) string {
	c, err := s.active(ctx, ownerID, "mail")
	if err != nil {
		return ""
	}
	return c.Kind()
}

// VerifyConnector —— 按名解析连接器跑连接测试（protocol connect 用）。未注册 → 错；不支持
// 连接测试（非 Verifier）→ nil（存即可用，无需测试）。
func (s *Slots) VerifyConnector(ctx context.Context, connectorID, ownerID string) error {
	c, ok := s.hub.Resolve(connectorID)
	if !ok {
		return fmt.Errorf("verify connector %q: %w", connectorID, errNoActiveConnector)
	}
	v, isVerifier := c.(Verifier)
	if !isVerifier {
		return nil
	}
	if err := v.Verify(ctx, ownerID); err != nil {
		return fmt.Errorf("verify connector %q: %w", connectorID, err)
	}
	return nil
}

// Calendar —— 一个把 calendar 契约分派到 active 连接器的 CalendarProxy。
func (s *Slots) Calendar() contract.CalendarProxy { return calendarSlot{s: s} }

// Mail —— 一个把 mail 契约分派到 active 连接器的 MailProxy。
func (s *Slots) Mail() contract.MailProxy { return mailSlot{s: s} }

// active —— 找 owner 某品类的 active 连接器句柄。无 active / 未注册 → errNoActiveConnector。
func (s *Slots) active(ctx context.Context, ownerID, category string) (Connector, error) {
	id, err := s.store.ActiveConnectorID(ctx, ownerID, category)
	if err != nil {
		return nil, fmt.Errorf("resolve active %s connector: %w", category, err)
	}
	if id == "" {
		return nil, errNoActiveConnector
	}
	c, found := s.hub.Resolve(id)
	if !found {
		return nil, errNoActiveConnector
	}
	return c, nil
}

// ─── calendar 槽 ───

type calendarSlot struct{ s *Slots }

// Connected —— 有 active calendar 连接器且它连上 → true；无 active → false（gate 掉，不报错）。
func (cs calendarSlot) Connected(ctx context.Context, ownerID string) (bool, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if errors.Is(err, contract.ErrCalendarNotConnected) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	ok, cerr := cal.Connected(ctx, ownerID)
	if cerr != nil {
		return false, fmt.Errorf("calendar slot connected: %w", cerr)
	}
	return ok, nil
}

func (cs calendarSlot) FreeBusy(
	ctx context.Context, ownerID string, req contract.FreeBusyReq,
) ([]contract.BusyInterval, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	busy, ferr := cal.FreeBusy(ctx, ownerID, req)
	if ferr != nil {
		return nil, fmt.Errorf("calendar slot freebusy: %w", ferr)
	}
	return busy, nil
}

func (cs calendarSlot) InsertEvent(
	ctx context.Context, ownerID string, req *contract.InsertEventReq,
) (contract.InsertedEvent, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return contract.InsertedEvent{}, err
	}
	ev, ierr := cal.InsertEvent(ctx, ownerID, req)
	if ierr != nil {
		return contract.InsertedEvent{}, fmt.Errorf("calendar slot insert: %w", ierr)
	}
	return ev, nil
}

func (cs calendarSlot) DeleteEvent(
	ctx context.Context, ownerID, eventID, attendeeEmail string,
) error {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return err
	}
	if derr := cal.DeleteEvent(ctx, ownerID, eventID, attendeeEmail); derr != nil {
		return fmt.Errorf("calendar slot delete: %w", derr)
	}
	return nil
}

// resolve —— active calendar 连接器断言成 CalendarProxy。无 active → ErrCalendarNotConnected。
func (cs calendarSlot) resolve(
	ctx context.Context, ownerID string,
) (contract.CalendarProxy, error) {
	c, err := cs.s.active(ctx, ownerID, "calendar")
	if errors.Is(err, errNoActiveConnector) {
		return nil, contract.ErrCalendarNotConnected
	}
	if err != nil {
		return nil, err
	}
	cal, isCal := c.(contract.CalendarProxy)
	if !isCal {
		return nil, fmt.Errorf("connector %q is not a calendar connector", c.Name())
	}
	return cal, nil
}

// ─── mail 槽 ───

type mailSlot struct{ s *Slots }

// Connected —— 有 active mail 连接器且它连上 → true；无 active → false。
func (ms mailSlot) Connected(ctx context.Context, ownerID string) (bool, error) {
	mp, err := ms.resolve(ctx, ownerID)
	if errors.Is(err, consumer.ErrMailNotConfigured) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	ok, cerr := mp.Connected(ctx, ownerID)
	if cerr != nil {
		return false, fmt.Errorf("mail slot connected: %w", cerr)
	}
	return ok, nil
}

func (ms mailSlot) Send(ctx context.Context, ownerID string, msg contract.MailMessage) error {
	mp, err := ms.resolve(ctx, ownerID)
	if err != nil {
		return err
	}
	if serr := mp.Send(ctx, ownerID, msg); serr != nil {
		return fmt.Errorf("mail slot send: %w", serr)
	}
	return nil
}

// resolve —— active mail 连接器断言成 MailProxy。无 active → ErrMailNotConfigured。
func (ms mailSlot) resolve(ctx context.Context, ownerID string) (contract.MailProxy, error) {
	c, err := ms.s.active(ctx, ownerID, "mail")
	if errors.Is(err, errNoActiveConnector) {
		return nil, consumer.ErrMailNotConfigured
	}
	if err != nil {
		return nil, err
	}
	mp, isMail := c.(contract.MailProxy)
	if !isMail {
		return nil, fmt.Errorf("connector %q is not a mail connector", c.Name())
	}
	return mp, nil
}
