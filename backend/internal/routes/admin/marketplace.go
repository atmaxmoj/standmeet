// marketplace.go —— admin marketplace routes：GET /search + POST /install + /install-manual。
//
// 能力来自出站收口（通用件在 dispatch.go）。装进来的产物是一个 skill，
// 载荷形状跟 /skills 那边是同一份 —— 收口里 marketplace 和 skills 共用 skillRow。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MarketplaceAdminDeps —— admin marketplace handlers 的能力来源。
type MarketplaceAdminDeps struct {
	Face *dispatcher.Face
}

// MountMarketplace —— GET /search 列市场结果；POST /install 抓 SKILL.md 落成真 skill；
// /install-manual 收 owner 手里粘进来的 SKILL.md。
func (h *Handlers) MountMarketplace(r chi.Router) {
	face := h.MarketplaceAdmin.Face
	r.Route("/marketplace", func(r chi.Router) {
		r.Get("/search", h.dispatchOp(face, "marketplace.search",
			queryArgsRenamed(map[string]string{"q": "query", "source": "source"},
				"limit", "offset"), jsonOK))
		r.Post("/install", h.dispatchOp(face, "marketplace.install", bodyArgs, jsonCreated))
		r.Post("/install-manual",
			h.dispatchOp(face, "marketplace.install_manual", bodyArgs, jsonCreated))
	})
}
