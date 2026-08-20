// invoke.go —— 连接器 reach-back 的 verb 派发器。#135 constrained-reachback：沙箱能力
// 消费连接器的**唯一**形状 —— `Invoke(category, verb, argsJSON)`。容器只按**名**用:host
// 按 category 解析 owner 的 active 连接器，按 verb 分派到品类契约的 typed 方法，回原始 JSON。
// 消费者永远拿不到 typed proxy（不像旧的 BookerDeps.Proxy 那样把接口塞进 deps）。
//
// typed CalendarProxy/MailProxy 在这里退成连接器层内部细节:args 解成契约的 typed 请求、
// 结果编回 JSON，跨 socket 的两端都只见 JSON。未知 category/verb → 错（caller 折成 tool 错）。

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// calVerb / mailVerb —— 单个 verb 的分派器（map 派发，避免大 switch 抬圈复杂度）。
type calVerb func(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

type mailVerb func(
	ctx context.Context, m contract.MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

// 品类名在**连接器轴内部**各出现一次。轴外(内核 / 路由 / 组装根)只传字符串。
const (
	categoryCalendar = "calendar"
	categoryMail     = "mail"
)

var calendarVerbs = map[string]calVerb{
	"connected":    calConnected,
	"free_busy":    calFreeBusy,
	"insert_event": calInsertEvent,
	"delete_event": calDeleteEvent,
}

var mailVerbs = map[string]mailVerb{
	"connected": mailConnected,
	"send":      mailSend,
}

// Invoke —— 按 category 解析 active 连接器、按 verb 分派、回原始 JSON。这是 reach-back
// gateway 的 `connector.invoke` op 的后端。
func (s *Slots) Invoke(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	out, err := s.dispatchCategory(ctx, ownerID, category, verb, args)
	if err != nil {
		// 失败**带着类别**交出去。沙箱那一侧断了网，只能凭这个 code 分岔；没有它，
		// 「owner 没配过」和「配了但这一刻拨不通」到了访客屏幕上是同一句话，
		// 而其中一句是假的（F-C-42）。分类归这里：哨兵是这个域的，
		// 路由那层薄壳按设计不认识它们。
		return nil, &hostop.FaultError{Code: faultOf(err), Err: err}
	}
	return out, nil
}

func (s *Slots) dispatchCategory(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	switch category {
	case categoryCalendar:
		return dispatchCalendar(ctx, s.Calendar(), ownerID, verb, args)
	case categoryMail:
		return dispatchMail(ctx, s.Mail(), ownerID, verb, args)
	default:
		return nil, fmt.Errorf("connector invoke: unknown category %q", category)
	}
}

// faultOf —— 哪一类。**只分两类**：「这条路没搭起来」和「搭了但这一刻做不到」——
// 因为下游据此说的那两句话就只有两种。想说得更细属于句子的事，不属于类别。
func faultOf(err error) string {
	if errors.Is(err, consumer.ErrMailNotConfigured) ||
		errors.Is(err, contract.ErrCalendarNotConnected) {
		return hostop.FaultNotConfigured
	}
	return hostop.FaultUnavailable
}

// InvokeByIDInput —— 按 id 直打一个连接器要的东西(打包:参数超过 argument-limit)。
type InvokeByIDInput struct {
	OwnerID  string
	ID       string
	Category string
	Verb     string
	Args     json.RawMessage
}

// InvokeByID —— 按**连接器 id**跑一次品类动词(不经 active 槽)。
//
// 跟 Invoke 的差别只有"打谁":Invoke 打品类的 active 槽,这条直接打指定的那一个。
// diag 要的是后者 —— owner 刚传上来一份绑定,要验它本身对不对,不该被"哪个是 active"干扰。
//
// 出参跟 Invoke 完全一样(那份归一 JSON),所以调用方一个品类类型都不必认识。
func (s *Slots) InvokeByID(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	switch in.Category {
	case categoryCalendar:
		return s.byIDCalendar(ctx, in)
	case categoryMail:
		return s.byIDMail(ctx, in)
	default:
		return nil, fmt.Errorf("connector invoke: unknown category %q", in.Category)
	}
}

func (s *Slots) byIDCalendar(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	cal, ok := s.ConnectorCalendar(in.ID)
	if !ok {
		return nil, fmt.Errorf("%w: %q is not a %s connector", ErrNotFound, in.ID, in.Category)
	}
	return dispatchCalendar(ctx, cal, in.OwnerID, in.Verb, in.Args)
}

func (s *Slots) byIDMail(
	ctx context.Context, in *InvokeByIDInput,
) (json.RawMessage, error) {
	m, ok := s.ConnectorMail(in.ID)
	if !ok {
		return nil, fmt.Errorf("%w: %q is not a %s connector", ErrNotFound, in.ID, in.Category)
	}
	return dispatchMail(ctx, m, in.OwnerID, in.Verb, in.Args)
}

func dispatchCalendar(
	ctx context.Context, cal contract.CalendarProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := calendarVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("connector invoke: unknown calendar verb %q", verb)
	}
	return fn(ctx, cal, ownerID, args)
}

func dispatchMail(
	ctx context.Context, m contract.MailProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := mailVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("connector invoke: unknown mail verb %q", verb)
	}
	return fn(ctx, m, ownerID, args)
}

// ─── calendar verbs ───

func calConnected(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := cal.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("calendar connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func calFreeBusy(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req contract.FreeBusyReq
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode free_busy args: %w", err)
	}
	out, err := cal.FreeBusy(ctx, ownerID, req)
	if err != nil {
		return nil, fmt.Errorf("calendar free_busy: %w", err)
	}
	b, merr := json.Marshal(out)
	if merr != nil {
		return nil, fmt.Errorf("connector invoke: marshal free_busy: %w", merr)
	}
	return b, nil
}

func calInsertEvent(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req contract.InsertEventReq
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode insert_event args: %w", err)
	}
	out, err := cal.InsertEvent(ctx, ownerID, &req)
	if err != nil {
		return nil, fmt.Errorf("calendar insert_event: %w", err)
	}
	b, merr := json.Marshal(out)
	if merr != nil {
		return nil, fmt.Errorf("connector invoke: marshal insert_event: %w", merr)
	}
	return b, nil
}

// delEventArgs —— delete_event 的入参形状（品类契约无 typed 请求，就这两个串）。
type delEventArgs struct {
	EventID       string `json:"event_id"`
	AttendeeEmail string `json:"attendee_email"`
}

func calDeleteEvent(
	ctx context.Context, cal contract.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req delEventArgs
	if err := json.Unmarshal(args, &req); err != nil {
		return nil, fmt.Errorf("connector invoke: decode delete_event args: %w", err)
	}
	if err := cal.DeleteEvent(ctx, ownerID, req.EventID, req.AttendeeEmail); err != nil {
		return nil, fmt.Errorf("calendar delete_event: %w", err)
	}
	return marshalBool("ok", true)
}

// ─── mail verbs ───

func mailConnected(
	ctx context.Context, m contract.MailProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := m.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func mailSend(
	ctx context.Context, m contract.MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var msg contract.MailMessage
	if err := json.Unmarshal(args, &msg); err != nil {
		return nil, fmt.Errorf("connector invoke: decode send args: %w", err)
	}
	if err := m.Send(ctx, ownerID, msg); err != nil {
		return nil, fmt.Errorf("mail send: %w", err)
	}
	return marshalBool("ok", true)
}

// ─── marshal helpers（都收具体类型，不碰 forbidigo 禁的 any）───

func marshalBool(key string, v bool) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]bool{key: v})
	if err != nil {
		return nil, fmt.Errorf("connector invoke: marshal %s: %w", key, err)
	}
	return b, nil
}
