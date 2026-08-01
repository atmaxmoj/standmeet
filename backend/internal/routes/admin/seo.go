// seo.go —— /api/admin/seo/*：这台实例被搜索引擎和分享卡片看见的那一面。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：设置在 /seo，
// 计数在 /seo/stats，单条条目走 /corpus/{genre}/{id}/seo（genre 和 id 在路径上）。
//
// 迁移前差了两处：MCP 的 update_settings 不带 site_title，而那条 upsert 整行覆写 ——
// 从 Claude Code 改一次 robots 就把 owner 写的站点标题洗掉了；另外 wiki / output
// 在面板这边早就是一条路由，在 MCP 那边还是两个工具。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// SEOAdminDeps —— admin SEO handlers 的能力来源。
type SEOAdminDeps struct {
	Face *dispatcher.Face
}

// MountSEO 挂 /seo + /seo/stats + /corpus/{genre}/{id}/seo。
func (h *Handlers) MountSEO(r chi.Router) {
	face := h.SEOAdmin.Face
	r.Get("/seo", h.dispatchOp(face, "seo.get_settings", emptyArgs, jsonOK))
	r.Put("/seo", h.dispatchOp(face, "seo.update_settings", bodyArgs, jsonOK))
	r.Get("/seo/stats", h.dispatchOp(face, "seo.stats", emptyArgs, jsonOK))
	// genre 和 id 都在路径上（面板早就把 wiki / output 收成一条路由）。
	r.Patch("/corpus/{genre}/{id}/seo",
		h.dispatchOp(face, "seo.set_entry_seo", bodyWithURLParam("genre", "id"), jsonOK))
}
