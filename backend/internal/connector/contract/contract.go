// Package contract —— the connector axis's typed CATEGORY contracts (#135 Slice A).
//
// These are the typed proxy interfaces + DTOs a capability uses to reach a connector
// CATEGORY (calendar, …) without knowing the provider. They live OUTSIDE the kernel:
// the connector adapters (internal/connector) implement them, the capability plugins
// (internal/plugins/booker) consume them, and the composition root wires the concrete
// adapter in. The kernel (usecases/inference/domain) holds NO typed category surface —
// so booking logic has nothing to call there; that is the "un-writable" lock.
//
// Provider-agnostic by construction: pure time/string DTOs, no gcal/caldav types.
package contract

import (
	"context"
	"time"
)

// CalendarProxy —— 出站日历连接器的代调口。ownerID = 句柄;凭据/token 刷新全在
// 实现侧 (internal/connector),从不进消费方。
type CalendarProxy interface {
	// Connected —— 连接器是否可用(有凭据 + 已授权)。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// FreeBusy —— owner 主日历在 [TimeMin,TimeMax] 的忙时段。
	FreeBusy(ctx context.Context, ownerID string, req FreeBusyReq) ([]BusyInterval, error)
	// InsertEvent —— 在 owner 主日历建事件,返回事件 id + 链接。
	InsertEvent(ctx context.Context, ownerID string, req *InsertEventReq) (InsertedEvent, error)
	// DeleteEvent —— 删事件(404/410 当成功,由 adapter 吸收)。attendeeEmail 非空 →
	// 通知与会者取消(sendUpdates=all)。
	DeleteEvent(ctx context.Context, ownerID, eventID, attendeeEmail string) error
}

// FreeBusyReq —— FreeBusy 入参(UTC 时间窗)。json tag 声明 connector.invoke 的 reach-back 线格。
type FreeBusyReq struct {
	TimeMin time.Time `json:"time_min"`
	TimeMax time.Time `json:"time_max"`
}

// BusyInterval —— 一个忙时段。
type BusyInterval struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

// InsertEventReq —— 建事件入参。VisitorEmail 空 = 不加与会者、不发通知。
type InsertEventReq struct {
	Summary      string    `json:"summary"`
	Description  string    `json:"description"`
	Start        time.Time `json:"start"`
	End          time.Time `json:"end"`
	TimeZone     string    `json:"time_zone"`
	VisitorEmail string    `json:"visitor_email"`
}

// InsertedEvent —— 建好的事件标识。
type InsertedEvent struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
}
