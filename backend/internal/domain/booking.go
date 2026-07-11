// booking.go —— calendar.book agent-skill domain types: connector,
// owner availability policy, booking record, and the typed results /
// failure reasons the BookMeeting usecase returns.
//
// 时间字段已 normalized 到 UTC instant (time.Time)；wall-clock 字段
// ('HH:MM') 是 string；timezone 是 IANA name string。

package domain

import (
	"errors"
	"time"
)

const (
	// CalendarProvider —— self-host 第一版仅 'google'。
	CalendarProvider = "google"

	// tokenStaleThreshold —— 提前多少秒认 access_token 过期 (>0 让 refresh
	// 在真过期前发生)。
	tokenStaleThreshold = 60 * time.Second

	// DefaultMinLeadDays —— DefaultBookingPolicy 的 min_lead_days 兜底 (2 天)。
	DefaultMinLeadDays = 2
	// DefaultBufferMin —— DefaultBookingPolicy 的 buffer_min 兜底。
	DefaultBufferMin = 15
)

// CalendarConnector —— owner OAuth state。所有 token 字段都是 decrypted
// 形态，仅在内存里出现；持久化是 cryptobox encrypted bytes，由 postgres
// repo 在边界做加解密。
//
// AccessTokenExpiresAt nil → 仅有 client credentials, 尚未 OAuth 授权。
// RefreshToken 空 → 同上，或者 owner 通过 disconnect 已撤销。
type CalendarConnector struct {
	ConnectedAt          *time.Time
	AccessTokenExpiresAt *time.Time
	OwnerID              string
	Provider             string
	ClientID             string
	ClientSecret         string
	AccessToken          string
	RefreshToken         string
	Scopes               []string
}

// HasCredentials —— owner 已粘 client_id + client_secret 但可能没授权。
func (c *CalendarConnector) HasCredentials() bool {
	return c.ClientID != "" && c.ClientSecret != ""
}

// Connected —— 完整授权过且至少拿到 refresh_token。
func (c *CalendarConnector) Connected() bool {
	return c.HasCredentials() && c.RefreshToken != ""
}

// AccessTokenStale —— access_token 过期或快过期，BookMeeting 应先 refresh。
func (c *CalendarConnector) AccessTokenStale() bool {
	if c.AccessTokenExpiresAt == nil {
		return true
	}
	return time.Now().Add(tokenStaleThreshold).After(*c.AccessTokenExpiresAt)
}

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
	// 一笔 booking 只发一次:非 nil 时再发 → ErrConfirmationAlreadySent。
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

// BookConflictReason / BookResult / BookBusyWindow 见 booking_result.go。

// ───── BookMeeting sentinel errors ─────────────────────────────

// ErrCalendarNotConnected —— BookMeeting 调用时 owner 还没完成 OAuth。
var ErrCalendarNotConnected = errors.New("calendar connector not connected")

// ErrCalendarRevoked —— refresh_token 失效 (用户在 Google 那边 revoke 了)。
var ErrCalendarRevoked = errors.New("calendar oauth revoked")

// ErrCalendarUnavailable —— 日历服务瞬时不可用（5xx / 网络抖动）且重试预算用尽。
// connector 把瞬时错耗尽翻成它；visitor-facing 层映成「稍后再试」友好降级。
var ErrCalendarUnavailable = errors.New("calendar temporarily unavailable")

// ErrCalendarBadRequest —— 请求本身不合法（pre-flight：binding 求出的 body 缺必填字段等）。
// 客户端错（4xx），不是上游故障；connector 把 openapi pre-flight 错翻成它。
var ErrCalendarBadRequest = errors.New("calendar request invalid")

// ErrCalendarBlockedEgress —— 连接器出站目标落在内网（SSRF 守卫拦下）。独立 sentinel：消息固定
// 干净（不回显被拦的内网 URL，防 metadata 路径外泄），且映成 4xx 配置错。
var ErrCalendarBlockedEgress = errors.New(
	"calendar connector blocked: target resolves to an internal/private address")

// ErrBookingPolicyMissingHours —— working_hours_* 值格式错。
var ErrBookingPolicyMissingHours = errors.New("booking policy hours malformed")

// ErrBookingNotFound —— E-14c: GetBookingByID / DeleteBooking 未命中
// 或 ownership 不匹 (不泄露存在性)。
var ErrBookingNotFound = errors.New("booking not found")

// ErrBookingQuotaExhausted —— the code's max_bookings cap is reached (enforced atomically at the
// insert, so it fires even when the assembly-time hide is bypassed (concurrent / within-turn).
var ErrBookingQuotaExhausted = errors.New("booking quota exhausted for this code")

// ErrBookingAlreadyConfirmed —— the confirmation was already claimed (0 rows). Claim-before-send
// makes concurrent double-send impossible.
var ErrBookingAlreadyConfirmed = errors.New("booking confirmation already claimed")
