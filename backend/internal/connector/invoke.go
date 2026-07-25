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
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// calVerb / mailVerb —— 单个 verb 的分派器（map 派发，避免大 switch 抬圈复杂度）。
type calVerb func(
	ctx context.Context, cal usecases.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

type mailVerb func(
	ctx context.Context, m usecases.MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error)

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
	switch category {
	case "calendar":
		return dispatchCalendar(ctx, s.Calendar(), ownerID, verb, args)
	case "mail":
		return dispatchMail(ctx, s.Mail(), ownerID, verb, args)
	default:
		return nil, fmt.Errorf("connector invoke: unknown category %q", category)
	}
}

func dispatchCalendar(
	ctx context.Context, cal usecases.CalendarProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := calendarVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("connector invoke: unknown calendar verb %q", verb)
	}
	return fn(ctx, cal, ownerID, args)
}

func dispatchMail(
	ctx context.Context, m usecases.MailProxy, ownerID, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	fn, ok := mailVerbs[verb]
	if !ok {
		return nil, fmt.Errorf("connector invoke: unknown mail verb %q", verb)
	}
	return fn(ctx, m, ownerID, args)
}

// ─── calendar verbs ───

func calConnected(
	ctx context.Context, cal usecases.CalendarProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := cal.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("calendar connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func calFreeBusy(
	ctx context.Context, cal usecases.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req usecases.FreeBusyReq
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
	ctx context.Context, cal usecases.CalendarProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var req usecases.InsertEventReq
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
	ctx context.Context, cal usecases.CalendarProxy, ownerID string, args json.RawMessage,
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
	ctx context.Context, m usecases.MailProxy, ownerID string, _ json.RawMessage,
) (json.RawMessage, error) {
	ok, err := m.Connected(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("mail connected: %w", err)
	}
	return marshalBool("connected", ok)
}

func mailSend(
	ctx context.Context, m usecases.MailProxy, ownerID string, args json.RawMessage,
) (json.RawMessage, error) {
	var msg usecases.MailMessage
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
