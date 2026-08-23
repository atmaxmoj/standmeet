// custom_pages.go —— /api/admin/custom-pages：owner 的 React 自定义页。
//
// 读 + **写**。写这一组曾经只在 MCP 上，例外的理由是「面板没有这个界面」——
// 用现状解释现状，而且写在棘轮读得到的地方，于是缺口从此不再被报（见
// internal/owner/ops/custom_pages.go 那段注释）。例外删掉之后，收口在启动时点名要这八条，
// 服务器在它们挂上之前直接拒绝启动。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：
// 建一个回 201、其余回 200，资源 id 走路径、其余进 body。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CustomPagesDeps —— admin custom-pages handler 的能力来源。
type CustomPagesDeps struct {
	Face *dispatcher.Face
}

// MountCustomPages 挂 /custom-pages 子路由。
func (h *Handlers) MountCustomPages(r chi.Router) {
	face := h.CustomPagesAdmin.Face
	r.Route("/custom-pages", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "custom_page.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "custom_page.create", bodyArgs, jsonCreated))
		r.Get("/builds/{build_id}",
			h.dispatchOp(face, "custom_page.get_build", urlParamArgs("build_id"), jsonOK))
		h.mountCustomPageItem(r, face)
	})
}

// mountCustomPageItem —— /{slug} 那一组。slug 走路径，其余进 body，跟 skills 那一面同形。
func (h *Handlers) mountCustomPageItem(r chi.Router, face *dispatcher.Face) {
	r.Route("/{slug}", func(r chi.Router) {
		r.Put("/files",
			h.dispatchOp(face, "custom_page.write_file", bodyWithURLParam("slug"), jsonOK))
		r.Post("/build", h.dispatchOp(face, "custom_page.build", urlParamArgs("slug"), jsonOK))
		r.Put("/byoai",
			h.dispatchOp(face, "custom_page.set_byoai", bodyWithURLParam("slug"), jsonOK))
		r.Post("/staging",
			h.dispatchOp(face, "custom_page.promote_to_staging", bodyWithURLParam("slug"), jsonOK))
		r.Post("/live",
			h.dispatchOp(face, "custom_page.promote_to_live", bodyWithURLParam("slug"), jsonOK))
		r.Post("/rollback",
			h.dispatchOp(face, "custom_page.rollback", urlParamArgs("slug"), jsonOK))
		r.Delete("/", h.dispatchOp(face, "custom_page.delete", urlParamArgs("slug"), jsonOK))
	})
}
