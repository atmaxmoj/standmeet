// appearance.go —— admin /appearance/css：owner 自定义 CSS 的读/写。
//
// 写时经域的 SetOwnerCSS sanitize + scope 后落库，读回的是那个安全版本。
// owner CSS 三面（admin UI / MCP / vault sync）写同一处（owners.custom_css）。
//
// 能力来自出站收口（通用件在 dispatch.go）。PUT 现在也回一份载荷 ——
// 就是**存好之后**的那份 CSS，让调用方看到真正生效的东西，而不是自己刚发出去的原文。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AppearanceAdminDeps —— admin appearance handlers 的能力来源。
type AppearanceAdminDeps struct {
	Face *dispatcher.Face
}

// MountAppearance —— /appearance 子路由。
func (h *Handlers) MountAppearance(r chi.Router) {
	face := h.AppearanceAdmin.Face
	r.Route("/appearance", func(r chi.Router) {
		r.Get("/css", h.dispatchOp(face, "appearance.get_css", emptyArgs, jsonOK))
		r.Put("/css", h.dispatchOp(face, "set_owner_css", bodyArgs, jsonOK))
	})
}
