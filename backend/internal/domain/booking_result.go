// booking_result.go —— BookMeeting return vocabulary (split from
// booking.go to fit max-public-structs ≤5 per file).

package domain

import "time"

// BookConflictReason —— BookMeeting 拒一单的具体原因。
type BookConflictReason string

const (
	// BookConflictAllBusy —— 全部 preferred_time 跟 owner 现有 event 冲突。
	BookConflictAllBusy BookConflictReason = "all_busy"
	// BookConflictLeadTime —— preferred_time 距 now() 不足 min_lead_hours。
	BookConflictLeadTime BookConflictReason = "lead_time"
	// BookConflictWeekday —— 周几不在 allowed_weekdays 里。
	BookConflictWeekday BookConflictReason = "weekday_not_allowed"
	// BookConflictHours —— wall-clock 不在 working_hours_start..end。
	BookConflictHours BookConflictReason = "outside_hours"
	// BookConflictQuotaExhausted —— code 的 max_bookings 已耗尽。
	BookConflictQuotaExhausted BookConflictReason = "quota_exhausted"
)

// BookBusyWindow —— calendar.book 失败时 (all_busy) 给 agent 看的 conflict
// window 列表。RFC3339 strings。json tags 让 tool-result encoder 序列化时
// 出小写键 (LLM 读起来更自然)。
type BookBusyWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// BookResult —— BookMeeting 返回的统一 envelope. OK=true 走 happy。
// Happy fields (EventID / HTMLLink / Start / End) 仅 OK=true valid。
// Busy fields (BusyWindows) 仅 Reason=BookConflictAllBusy 时 populated。
type BookResult struct {
	Start       time.Time
	End         time.Time
	Reason      BookConflictReason
	EventID     string
	HTMLLink    string
	PolicyHint  string
	BusyWindows []BookBusyWindow
	OK          bool
}
