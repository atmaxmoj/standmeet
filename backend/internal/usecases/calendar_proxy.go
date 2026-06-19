// calendar_proxy.go —— Phase B：连接器 proxy 的 **port**（ports & adapters）。
//
// 凭据永不出 vault：booking 这层只拿 ownerID(句柄)调 proxy，proxy（实现在
// internal/connector）内部 load 连接器、解密、刷新 token、调 Google —— access
// token 这串值**从不进 usecases 这层**。usecases 既不 import gcal、也不 import
// connector（只持这个接口，wireup 注入 adapter）。
//
// DTO 用纯 time/string，不带任何 gcal 类型 → boundary gate 满足。

package usecases

import (
	"context"
	"time"
)

// CalendarProxy —— 出站日历连接器的代调口。ownerID = 句柄。
type CalendarProxy interface {
	// Connected —— 连接器是否可用（有凭据 + 已授权）。
	Connected(ctx context.Context, ownerID string) (bool, error)
	// FreeBusy —— owner 主日历在 [TimeMin,TimeMax] 的忙时段。
	FreeBusy(ctx context.Context, ownerID string, req FreeBusyReq) ([]BusyInterval, error)
	// InsertEvent —— 在 owner 主日历建事件，返回事件 id + 链接。
	InsertEvent(ctx context.Context, ownerID string, req *InsertEventReq) (InsertedEvent, error)
	// DeleteEvent —— 删事件（404/410 当成功，由 adapter 吸收）。attendeeEmail
	// 非空 → 通知与会者取消（sendUpdates=all）。
	DeleteEvent(ctx context.Context, ownerID, eventID, attendeeEmail string) error
}

// FreeBusyReq —— FreeBusy 入参（UTC 时间窗）。
type FreeBusyReq struct {
	TimeMin time.Time
	TimeMax time.Time
}

// BusyInterval —— 一个忙时段。
type BusyInterval struct {
	Start time.Time
	End   time.Time
}

// InsertEventReq —— 建事件入参。VisitorEmail 空 = 不加与会者、不发通知。
type InsertEventReq struct {
	Summary      string
	Description  string
	Start        time.Time
	End          time.Time
	TimeZone     string
	VisitorEmail string
}

// InsertedEvent —— 建好的事件标识。
type InsertedEvent struct {
	EventID  string
	HTMLLink string
}
