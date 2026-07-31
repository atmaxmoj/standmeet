// capabilities.go —— 管理面 /api/admin/capabilities：owner 的「访客能用什么」面板。
//
//	GET    /api/admin/capabilities        → 列全部（capability / connector / skill）
//	PATCH  /api/admin/capabilities/{id}   → {enabled} owner-enable 开关（builtin 也可关）
//	DELETE /api/admin/capabilities/{id}   → 仅 owner-origin 可删，其余 4xx
//
// 能力来自出站收口（通用件在 dispatch.go）。origin 决定存在性（可删性），
// enabled 决定可用性（访客 session 是否装配）—— 两者的判定都在收口里，只有一份。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CapabilityAdminDeps —— admin capabilities handlers 的能力来源。
type CapabilityAdminDeps struct {
	Face *dispatcher.Face
}

// MountCapabilities 挂 /capabilities 子路由。
func (h *Handlers) MountCapabilities(r chi.Router) {
	face := h.CapabilitiesAdmin.Face
	r.Route("/capabilities", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "capabilities.list", emptyArgs, jsonOK))
		r.Patch("/{id}",
			h.dispatchOp(face, "capabilities.set_enabled", bodyWithURLParam("id"), jsonOK))
		r.Delete("/{id}",
			h.dispatchOp(face, "capabilities.delete", urlParamArgs("id"), jsonOK))
	})
}
