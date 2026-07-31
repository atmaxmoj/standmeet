// access_requests.go —— admin /access-requests endpoint (list + status update + approve)。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：
// status 过滤走 query、资源 id 走路径、其余进 body。
// 错误的状态码翻译也在这个面：收口只说“调用方给错了 / 找不到 / 机器出错”。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AccessRequestsDeps —— admin access-requests handlers 的能力来源。
type AccessRequestsDeps struct {
	Face *dispatcher.Face
}

// MountAccessRequests 挂 /access-requests 子路由。
func (h *Handlers) MountAccessRequests(r chi.Router) {
	face := h.AccessRequests.Face
	r.Get("/access-requests",
		h.dispatchOp(face, "access_requests.list", queryArgs("status"), jsonOK))
	r.Patch("/access-requests/{id}",
		h.dispatchOp(face, "access_requests.update", bodyWithURLParam("id"), jsonOK))
	r.Post("/access-requests/{id}/approve",
		h.dispatchOp(face, "access_requests.approve", urlParamArgs("id"), jsonOK))
}
