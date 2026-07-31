// account.go —— /api/admin/account/* + GET /me：owner 自己的账号。
//
// 能力来自出站收口（通用件在 dispatch.go）。改邮箱 / 改密码 / 生成恢复口令都带凭据，
// 是写下来的单面决定：只在 admin 上，MCP 不承载原始凭据。
//
// GET /me 回 {owner, settings} —— 迁移前 MCP 的 `me` 是手拼字符串出来的四字段 JSON，
// 而且没有转义（名字里一个引号就拼出非法 JSON）；现在两个面同一份形状、同一个序列化器。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AccountDeps —— admin account handlers 的能力来源。
type AccountDeps struct {
	Face *dispatcher.Face
}

// MountAccount 挂 /account/*（caller 前缀 /api/admin）。
func (h *Handlers) MountAccount(r chi.Router) {
	face := h.AccountAdmin.Face
	r.Route("/account", func(r chi.Router) {
		r.Patch("/full-name",
			h.dispatchOp(face, "account.set_full_name", bodyArgs, jsonOK))
		r.Patch("/timezone", h.dispatchOp(face, "account.set_timezone", bodyArgs, jsonOK))
		r.Patch("/email", h.dispatchOp(face, "account.change_email", bodyArgs, jsonOK))
		r.Patch("/password",
			h.dispatchOp(face, "account.change_password", bodyArgs, noContent))
		// #100: 生成 recovery phrase（只存 hash，明文邮给 owner）。
		r.Post("/recovery",
			h.dispatchOp(face, "account.generate_recovery", emptyArgs, jsonOK))
	})
}

// MountMe 挂 GET /me（caller 前缀 /api/admin）。
func (h *Handlers) MountMe(r chi.Router) {
	r.Get("/me", h.dispatchOp(h.AccountAdmin.Face, "me", emptyArgs, jsonOK))
}
