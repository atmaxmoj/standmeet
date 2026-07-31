// booking_types.go —— booking domain types owned by the booker plugin (#190). They used to live in
// the kernel `domain` package, but booking is a capability, so the plugin owns its own policy /
// record / conflict-reason shapes. Consumers (admin list, owner cap, composition root) import here.
// (Calendar-CONNECTOR errors are separate — see connector/contract/errors.go.)

package entity

import (
	"errors"
	"time"
)

// 预约**策略**不在这儿了 —— 它是 booker 这个外置能力自己的东西:字段和默认值声明在
// booker 的 manifest(Config),值存在 booker 自己的隔离存储,沙箱经 capconfig.get 读回。
// host 曾经有一份类型 + 默认值,沙箱有另一份,两份飘了(host 说工作到 18:00、缓冲 15 分钟,
// 沙箱按 17:00、缓冲 0),而注释还写着"跟沙箱一致"。
//
// 这里只剩 host 确实要认识的东西:一条**已经存在的预约记录**的形状(取消要按 id 找它)。

// CodeBooking —— 持久化的 calendar.book 记录（一条事件 = 一行）。
type CodeBooking struct {
	StartAt   time.Time
	EndAt     time.Time
	CreatedAt time.Time
	// ConfirmationSentAt —— 访客点过"发确认邮件"后落的时间;nil = 没发过。
	ConfirmationSentAt *time.Time
	ID                 string
	OwnerID            string
	CodeID             string
	ConversationID     string
	GoogleEventID      string
	GoogleHTMLLink     string
	Summary            string
	VisitorEmail       string
}

// BookConflictReason —— why a policy check rejects a slot.
type BookConflictReason string

const (
	// BookConflictLeadTime —— preferred_time 距 now() 不足 min_lead_days。
	BookConflictLeadTime BookConflictReason = "lead_time"
	// BookConflictWeekday —— 周几不在 allowed_weekdays 里。
	BookConflictWeekday BookConflictReason = "weekday_not_allowed"
	// BookConflictHours —— wall-clock 不在 working_hours_start..end。
	BookConflictHours BookConflictReason = "outside_hours"
)

// ErrBookingPolicyMissingHours —— working_hours_* 值格式错。
var ErrBookingPolicyMissingHours = errors.New("booking policy hours malformed")

// ErrBookingNotFound —— GetBookingByID / DeleteBooking / member-scope 未命中
// 或 ownership 不匹 (不泄露存在性)。
var ErrBookingNotFound = errors.New("booking not found")
