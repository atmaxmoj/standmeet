// handle.go —— PATCH /api/admin/handle：owner 改 URL handle。
//
// 能力来自出站收口；旧 handle 自动进 handle_aliases 是域的事（老链接仍能 resolve）。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// HandleDeps —— admin handle endpoint 的能力来源。
type HandleDeps struct {
	Face *dispatcher.Face
}

// MountHandle 挂 PATCH /handle（caller 前缀 /api/admin）。
func (h *Handlers) MountHandle(r chi.Router) {
	r.Patch("/handle", h.dispatchOp(h.HandleAdmin.Face, "page.set_handle", bodyArgs, jsonOK))
}
