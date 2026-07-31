// skills.go —— /api/admin/skills CRUD（#48-2）。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：
// 建一个回 201、其余回 200，资源 id 走路径、其余进 body。
//
// 出站载荷跟 MCP 面是同一份 —— 迁移前 MCP 的 skill_list 少了 allowed_tools / enabled，
// owner 从 Claude Code 看不出一个 skill 是不是被关掉了；现在只有一份形状。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// SkillsAdminDeps —— admin skills handlers 的能力来源。
type SkillsAdminDeps struct {
	Face *dispatcher.Face
}

// MountSkills 挂 /skills 子路由。
func (h *Handlers) MountSkills(r chi.Router) {
	face := h.SkillsAdmin.Face
	r.Route("/skills", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "skill_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "skill_create", bodyArgs, jsonCreated))
		r.Patch("/{skill_id}",
			h.dispatchOp(face, "skill_set_enabled", bodyWithURLParam("skill_id"), jsonOK))
		r.Delete("/{skill_id}",
			h.dispatchOp(face, "skill_delete", urlParamArgs("skill_id"), jsonOK))
	})
}
