// roles.go —— /api/admin/roles CRUD。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：
// 建一个回 201、其余回 200，资源 id 走路径、其余进 body。
//
// 出站载荷跟 MCP 面是同一份。迁移前这是差得最多的一个资源：MCP 的 role_list 只给
// skill/mcp 的**计数**，role_update 连 waypoints / dock_buttons /
// notify_owner_on_booking / require_ghost_evidence 都收不了 —— 也就是说 owner 从
// Claude Code 既看不见也改不了 require_ghost_evidence 这种安全相关的 per-role 开关。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// RolesAdminDeps —— admin roles handlers 的能力来源。
type RolesAdminDeps struct {
	Face *dispatcher.Face
}

// MountRoles 挂 /roles 子路由。
func (h *Handlers) MountRoles(r chi.Router) {
	face := h.RolesAdmin.Face
	r.Route("/roles", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "role_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "role_create", bodyArgs, jsonCreated))
		r.Get("/{role_id}", h.dispatchOp(face, "roles.get", urlParamArgs("role_id"), jsonOK))
		r.Put("/{role_id}",
			h.dispatchOp(face, "role_update", bodyWithURLParam("role_id"), jsonOK))
		r.Delete("/{role_id}",
			h.dispatchOp(face, "role_delete", urlParamArgs("role_id"), noContent))
	})
}
