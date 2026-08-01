// page.go —— /api/admin/page*：owner 的公开主页。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状。
//
// 迁移前这边拿到的 page 是**裸的**：insights/projects 只有 id，标题和摘要要前端自己再去
// 拼；MCP 那边拿到的是 join 过的。现在两个面同一份。「能 pin 什么」以前也只有这边有，
// 而且规则（pinned ⊆ published）写在 handler 里——现在在域里，两个面都问得到。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// PageAdminDeps —— admin page handlers 的能力来源。
type PageAdminDeps struct {
	Face *dispatcher.Face
}

// MountPage 挂 /page。caller 负责 /api/admin/ 前缀 + auth middleware。
func (h *Handlers) MountPage(r chi.Router) {
	face := h.PageAdmin.Face
	r.Get("/page", h.dispatchOp(face, "page.get", emptyArgs, jsonOK))
	r.Put("/page", h.dispatchOp(face, "page.put", bodyArgs, jsonOK))
	r.Get("/page/pinnable", h.dispatchOp(face, "page.pinnable", emptyArgs, jsonOK))
	r.Post("/page/pin", h.dispatchOp(face, "page.pin", bodyArgs, jsonOK))
	r.Post("/page/unpin", h.dispatchOp(face, "page.unpin", bodyArgs, jsonOK))
}
