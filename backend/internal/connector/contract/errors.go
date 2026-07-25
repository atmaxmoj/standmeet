// errors.go —— calendar-connector sentinel errors (#190). These are CONNECTOR-category outcomes
// (owner hasn't connected / oauth revoked / upstream 5xx / bad request / SSRF-blocked egress), not
// booking-domain concepts — so they live with the connector contract, consumed by the connector
// adapters + the capability plugins that call the calendar proxy. Moved out of the kernel domain.

package contract

import "errors"

// ErrCalendarNotConnected —— owner 还没完成 OAuth / 没连接日历。
var ErrCalendarNotConnected = errors.New("calendar connector not connected")

// ErrCalendarRevoked —— refresh_token 失效 (用户在 Google 那边 revoke 了)。
var ErrCalendarRevoked = errors.New("calendar oauth revoked")

// ErrCalendarUnavailable —— 日历服务瞬时不可用（5xx / 网络抖动）且重试预算用尽。
var ErrCalendarUnavailable = errors.New("calendar temporarily unavailable")

// ErrCalendarBadRequest —— 请求本身不合法（pre-flight：binding 求出的 body 缺必填字段等）。
var ErrCalendarBadRequest = errors.New("calendar request invalid")

// ErrCalendarBlockedEgress —— 连接器出站目标落在内网（SSRF 守卫拦下）。消息固定干净（不回显
// 被拦的内网 URL，防 metadata 路径外泄）。
var ErrCalendarBlockedEgress = errors.New(
	"calendar connector blocked: target resolves to an internal/private address")
