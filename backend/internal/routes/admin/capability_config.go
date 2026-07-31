// capability_config.go —— /api/admin/capabilities/{id}/config：**任意**能力的可设置项。
//
//	GET   /api/admin/capabilities/config          → 哪些能力有可设置项
//	GET   /api/admin/capabilities/{id}/config     → 该能力的字段（声明 + 当前值 + 默认值）
//	PATCH /api/admin/capabilities/{id}/config     → 写回
//
// 这是面板给能力留的通用口子。**这个文件里没有任何一个能力的名字**：字段是能力在自己的
// manifest 里声明的，面板按 type 渲染。以前每个能力要可设置就得在 admin 手写一套路由 +
// 表单（booker 的预约策略就是这么来的，然后跟沙箱那份飘了）。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CapabilityConfigAdminDeps —— admin 通用配置面的能力来源。
type CapabilityConfigAdminDeps struct {
	Face *dispatcher.Face
}

// MountCapabilityConfig 挂通用配置面（caller 前缀 /api/admin）。
func (h *Handlers) MountCapabilityConfig(r chi.Router) {
	face := h.CapabilityConfigAdmin.Face
	r.Route("/capabilities/config", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "capability_config.list", emptyArgs, jsonOK))
	})
	r.Get("/capabilities/{capability_id}/config",
		h.dispatchOp(face, "capability_config.get", urlParamArgs("capability_id"), jsonOK))
	r.Patch("/capabilities/{capability_id}/config",
		h.dispatchOp(face, "capability_config.set",
			bodyWithURLParam("capability_id"), jsonOK))
}
