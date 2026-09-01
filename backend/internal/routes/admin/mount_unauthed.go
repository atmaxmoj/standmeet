// mount_unauthed.go —— 不需要 owner session 的那几条 admin 路，和各自裹哪层 guard。
//
// 单独成文件，因为这里的判断跟任何一个处理器都无关：它决定的是**哪条路进哪个限速桶**，
// 而那个桶是共用的 —— 挑错了会让一条路把另一条路的额度花掉（下面 confirm-email 那段）。
// 这种判断埋在某个处理器文件的中间时没人会去复查。

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// MountUnauthed 挂不需要 owner session 的 endpoint。
// loginGuard 是 brute-force 防御（per-IP rate-limit + equal-time response）。
func (h *Handlers) MountUnauthed(
	r chi.Router, loginGuard func(http.Handler) http.Handler,
) {
	// claim 用一次性 setup token，brute-force 不实际 —— 不裹。
	r.Post("/claim", h.claim())
	r.Group(func(r chi.Router) {
		r.Use(loginGuard)
		r.Post("/login", h.login())
		// #100: 公开的账号恢复 —— {email, phrase} 对上就发 session。
		// 跟 login 同套 guard 限速（brute-force 面一样）。
		r.Post("/recover", h.recover())
	})
	// 确认改邮箱 —— **公开**：owner 点开这封信时可能在另一台设备上、没登录。
	// 要求先登录才能确认，等于要求他先用还没换过去的那个身份登进来。
	//
	// **在 Group 外面**：loginGuard 的桶是 `<prefix>+ip`，一个 IP 一个，
	// /login /recover 共用同一个。写在 Group 里的话，点几次确认链接就消耗掉登录的额度 ——
	// 而这台实例如果前面那层代理没设 X-Forwarded-For（后端启动时会警告这件事），
	// 所有访客算同一个 IP，于是「确认邮箱」能把 owner 关在登录门外。
	//
	// 它自己不需要限速：token 是 128-bit 随机 + 只匹配 hash + 一次性 + 24h 过期，
	// 而且这条路造不出新的改动，只能兑现一次 owner 在登录状态下发起过的改动。
	//
	// ⚠️ 这几行以前就在，但**代码在 Group 里面** —— 注释说着「不裹」，
	// 而 panic 栈里清清楚楚经过 loginGuard。要改的是代码，不是这段话。
	r.Post("/confirm-email", h.confirmEmail())
}
