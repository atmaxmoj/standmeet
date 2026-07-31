// instance.go —— 这台实例自己的可观测面（admin 侧的六条只读路由）。
//
//	GET /system            #101 system 面板
//	GET /inference-usage   #106 计费面板
//	GET /stats/growth      Monitor: SystemPulse
//	GET /stats/graph       TopBar: corpus link constellation
//	GET /stats/activity    Monitor: ActivityTicker
//	GET /stats/jobs        Monitor: background jobs
//
// 能力来自出站收口（通用件在 dispatch.go）。路径是历史形状（system 和 stats/* 不同前缀），
// 保持不动 —— 前端按它们写的；变的只是能力的来源。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// InstanceAdminDeps —— admin 观测面的能力来源。
type InstanceAdminDeps struct {
	Face *dispatcher.Face
}

// MountInstance 挂这六条只读路由。
func (h *Handlers) MountInstance(r chi.Router) {
	face := h.InstanceAdmin.Face
	r.Get("/system", h.dispatchOp(face, "instance.status", emptyArgs, jsonOK))
	r.Get("/inference-usage",
		h.dispatchOp(face, "instance.inference_usage", emptyArgs, jsonOK))
	r.Get("/stats/growth", h.dispatchOp(face, "instance.corpus_growth", emptyArgs, jsonOK))
	r.Get("/stats/graph",
		h.dispatchOp(face, "instance.corpus_graph", queryArgsRenamed(nil, "limit"), jsonOK))
	r.Get("/stats/activity", h.dispatchOp(face, "instance.activity", emptyArgs, jsonOK))
	r.Get("/stats/jobs", h.dispatchOp(face, "instance.jobs", emptyArgs, jsonOK))
}
