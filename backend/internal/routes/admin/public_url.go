// public_url.go —— PATCH /api/admin/public-url：owner 改部署的 canonical public URL
// （claim 后改域名时）。
//
// owner.public_url 是 QR / canonical 链接的单一来源。能力来自出站收口。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// PublicURLDeps —— admin public-url endpoint 的能力来源。
type PublicURLDeps struct {
	Face *dispatcher.Face
}

// MountPublicURL 挂 PATCH /public-url（caller 前缀 /api/admin）。
func (h *Handlers) MountPublicURL(r chi.Router) {
	r.Patch("/public-url",
		h.dispatchOp(h.PublicURLAdmin.Face, "page.set_public_url", bodyArgs, jsonOK))
}
