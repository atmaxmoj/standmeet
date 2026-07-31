// domains.go —— /api/admin/allowed-domains CRUD（list + add + remove）。
// 真正的 DNS / TLS 验证走 /internal/tls-ask（Caddy on-demand TLS path）。
// 这里只维护 instance_settings.allowed_domains 这个 jsonb 数组。
//
// 能力来自出站收口（通用件在 dispatch.go）；路由形状仍是本面的决定 ——
// add / remove 历史上回 204 空身，前端按这个契约写的，所以继续回 204。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// DomainsDeps —— admin domains handlers 的能力来源。
type DomainsDeps struct {
	Face *dispatcher.Face
}

// MountDomains 挂 /allowed-domains 子路由。
func (h *Handlers) MountDomains(r chi.Router) {
	face := h.Domains.Face
	r.Get("/allowed-domains", h.dispatchOp(face, "domains.list", emptyArgs, jsonOK))
	r.Post("/allowed-domains", h.dispatchOp(face, "domains.add", bodyArgs, noContent))
	r.Delete("/allowed-domains/{domain}",
		h.dispatchOp(face, "domains.remove", urlParamArgs("domain"), noContent))
}
