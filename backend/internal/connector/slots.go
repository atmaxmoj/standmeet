// slots.go —— 品类槽位分派：把「品类契约」分派到该 owner 当前 active 的连接器（§9 槽位规则）。
// Hub 持装配好的连接器（按 connector_id），SlotStore 解析哪个是 owner 某品类的 active；消费者
// （booker / mailer）只认 usecases.CalendarProxy / MailProxy，不知背后是哪个 provider、哪 kind。
// 这是底座（Hub + 分派）与具体连接器之间的最后一环——主后端只见品类契约，没有任何 specific connector。

package connector

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
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

// Calendar —— 一个把 calendar 契约分派到 active 连接器的 CalendarProxy。
//
//nolint:ireturn // 返回品类契约接口供消费者注入，是这里的意图（消费者 provider-agnostic）。
func (s *Slots) Calendar() usecases.CalendarProxy { return calendarSlot{s: s} }

// Mail —— 一个把 mail 契约分派到 active 连接器的 MailProxy。
//
//nolint:ireturn // 同 Calendar。
func (s *Slots) Mail() usecases.MailProxy { return mailSlot{s: s} }

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
	if errors.Is(err, domain.ErrCalendarNotConnected) {
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
	ctx context.Context, ownerID string, req usecases.FreeBusyReq,
) ([]usecases.BusyInterval, error) {
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
	ctx context.Context, ownerID string, req *usecases.InsertEventReq,
) (usecases.InsertedEvent, error) {
	cal, err := cs.resolve(ctx, ownerID)
	if err != nil {
		return usecases.InsertedEvent{}, err
	}
	ev, ierr := cal.InsertEvent(ctx, ownerID, req)
	if ierr != nil {
		return usecases.InsertedEvent{}, fmt.Errorf("calendar slot insert: %w", ierr)
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
//
//nolint:ireturn // 返回品类契约接口供分派；同 Slots.Calendar 的意图。
func (cs calendarSlot) resolve(
	ctx context.Context, ownerID string,
) (usecases.CalendarProxy, error) {
	c, err := cs.s.active(ctx, ownerID, "calendar")
	if errors.Is(err, errNoActiveConnector) {
		return nil, domain.ErrCalendarNotConnected
	}
	if err != nil {
		return nil, err
	}
	cal, isCal := c.(usecases.CalendarProxy)
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
	if errors.Is(err, usecases.ErrMailNotConfigured) {
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

func (ms mailSlot) Send(ctx context.Context, ownerID string, msg usecases.MailMessage) error {
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
//
//nolint:ireturn // 返回品类契约接口供分派；同 Slots.Mail 的意图。
func (ms mailSlot) resolve(ctx context.Context, ownerID string) (usecases.MailProxy, error) {
	c, err := ms.s.active(ctx, ownerID, "mail")
	if errors.Is(err, errNoActiveConnector) {
		return nil, usecases.ErrMailNotConfigured
	}
	if err != nil {
		return nil, err
	}
	mp, isMail := c.(usecases.MailProxy)
	if !isMail {
		return nil, fmt.Errorf("connector %q is not a mail connector", c.Name())
	}
	return mp, nil
}
