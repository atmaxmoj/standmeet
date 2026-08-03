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
	"calendar connector blocked: target resolves to an internal/private address",
)

// mail 这一侧的对应物。calendar 早就有这套分类,mail 没有 —— 于是发信失败只能原样把
// provider 的错误往上抛(里面有状态码、主机名,有时还有栈)。面上要么把它整段透出去
// (对 owner 没意义,对旁观者是情报),要么整段吞掉(只说"失败",他不知道该改什么)。
// 分了类才有第三种选择:说一句他改得动的话。

// ErrMailUnavailable —— 送信方暂时不可用(5xx / 网络抖动 / 重试预算用尽)。owner 无需改配置。
var ErrMailUnavailable = errors.New("mail provider temporarily unavailable")

// ErrMailRejected —— 送信方拒收这一封(4xx:地址不合法、被列入黑名单、内容被拒)。
// 是**这封信**的问题,不是连接坏了。
var ErrMailRejected = errors.New("mail provider rejected the message")
