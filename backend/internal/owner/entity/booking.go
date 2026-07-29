// booking_types.go —— booking domain types owned by the booker plugin (#190). They used to live in
// the kernel `domain` package, but booking is a capability, so the plugin owns its own policy /
// record / conflict-reason shapes. Consumers (admin list, owner cap, composition root) import here.
// (Calendar-CONNECTOR errors are separate — see connector/contract/errors.go.)

package entity

import (
	"errors"
	"time"
)

const (
	// DefaultMinLeadDays —— DefaultBookingPolicy 的 min_lead_days 兜底 (2 天)。
	DefaultMinLeadDays = 2
	// DefaultBufferMin —— DefaultBookingPolicy 的 buffer_min 兜底。
	DefaultBufferMin = 15
)

// BookingPolicy —— owner availability constraints applied per book attempt.
type BookingPolicy struct {
	UpdatedAt         time.Time
	OwnerID           string
	WorkingHoursStart string // 'HH:MM'
	WorkingHoursEnd   string // 'HH:MM'
	AllowedWeekdays   []string
	MinLeadDays       int32
	BufferMin         int32
}

// DefaultBookingPolicy —— 没显式 set 时的兜底 (admin UI 也用同一份种子)。
func DefaultBookingPolicy(ownerID string) BookingPolicy {
	return BookingPolicy{
		OwnerID:           ownerID,
		MinLeadDays:       DefaultMinLeadDays,
		AllowedWeekdays:   []string{"mon", "tue", "wed", "thu", "fri"},
		WorkingHoursStart: "09:00",
		WorkingHoursEnd:   "18:00",
		BufferMin:         DefaultBufferMin,
	}
}

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
