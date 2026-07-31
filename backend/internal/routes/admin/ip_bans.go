// ip_bans.go —— /api/admin/ip-bans/* —— owner 看 / 加 / 删封禁 IP（#58-4）。
// 公开面 enforcement 走 middleware.BanGuard（另一处）；这里只是 owner 的 CRUD。
// 配合 conversations.client_ip 的「IP 感知」：owner 在对话里看到来源 IP →
// 来这儿封掉。
//
// **第一条从出站收口 wire 的 admin 路由。** 路由形状、方法、路径、参数位置照常手写 ——
// REST 长什么样是这个面自己的决定。变的是能力的来源：handler 里不再握着 security 的仓储，
// 而是从 dispatcher 的 admin Face 取 Op（通用件在 dispatch.go）。于是：
//
//   - 业务与校验只有一份（在收口里），MCP 面拿到的是同一个 Op，不会两边各写一套；
//   - 「这条路由服务了哪个能力」是收口记下的事实（取用即登记），parity 由结构回答，
//     不再需要一张手写对照表去事后对账。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// IPBansAdminDeps —— admin ip-bans 的能力来源：出站收口的 admin Face。
// 不再是仓储：这个面不该直接够到域。
type IPBansAdminDeps struct {
	Face *dispatcher.Face
}

// MountIPBans 挂 /ip-bans/* 子路由。
func (h *Handlers) MountIPBans(r chi.Router) {
	face := h.IPBansAdmin.Face
	r.Route("/ip-bans", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "ip_bans.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "ip_bans.add", bodyArgs, jsonOK))
		r.Delete("/{id}", h.dispatchOp(face, "ip_bans.remove", urlParamArgs("id"), jsonOK))
	})
}
