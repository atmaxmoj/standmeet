// prompts.go —— /api/admin/prompts CRUD。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：
// 建一个回 201、其余回 200，资源 id 走路径。
//
// 出站载荷跟 MCP 面是同一份 —— 迁移前 MCP 的 prompt_list **不带 body**，
// owner 从 Claude Code 列一遍看不到自己写的正文；现在只有一份形状。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// PromptsAdminDeps —— admin prompts handlers 的能力来源。
type PromptsAdminDeps struct {
	Face *dispatcher.Face
}

// MountPrompts 挂 /prompts 子路由。
func (h *Handlers) MountPrompts(r chi.Router) {
	face := h.PromptsAdmin.Face
	r.Route("/prompts", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "prompt_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "prompt_create", bodyArgs, jsonCreated))
		r.Get("/{prompt_id}",
			h.dispatchOp(face, "prompts.get", urlParamArgs("prompt_id"), jsonOK))
		r.Put("/{prompt_id}",
			h.dispatchOp(face, "prompt_update", bodyWithURLParam("prompt_id"), jsonOK))
		r.Delete("/{prompt_id}",
			h.dispatchOp(face, "prompt_delete", urlParamArgs("prompt_id"), jsonOK))
	})
}
