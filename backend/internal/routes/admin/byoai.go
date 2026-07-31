// byoai.go —— PUT /api/admin/byoai。owner 一次写三字段：enabled / providers / blurb。
//
// 能力来自出站收口（通用件在 dispatch.go）。响应是完整的 settings 一片（ai + byoai），
// 前端可以直接 swap 进缓存 —— 迁移前这条路径回的那份**漏了 ai.endpoint 和 ai.model**，
// swap 一次就把这两个字段抹空了；现在两条写路径和 GET /me 用的是同一份构造。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// BYOAIDeps —— admin BYOAI handlers 的能力来源。
type BYOAIDeps struct {
	Face *dispatcher.Face
}

// MountBYOAI 挂 PUT /byoai。
func (h *Handlers) MountBYOAI(r chi.Router) {
	r.Put("/byoai", h.dispatchOp(h.BYOAI.Face, "byoai.set", bodyArgs, jsonOK))
}
