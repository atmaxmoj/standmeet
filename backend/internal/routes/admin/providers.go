// providers.go —— admin /providers:owner 的 provider 本子(增删改 + 标默认)。
//
// 隔壁 /ai-provider 说的是**默认那一条**(setup 向导、claim、那张老表单都走它),
// 这里管的是本子本身。两条路写的是同一张表。
//
// 建那一条带明文 key,所以跟 ai_provider.set 一样只在这个面上;响应里没有 key ——
// 收口那侧的出站类型压根没有这个字段。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// ProvidersAdminDeps —— 路由的能力来源。
type ProvidersAdminDeps struct {
	Face *dispatcher.Face
}

// MountProviders 挂 /providers 那一组。
func (h *Handlers) MountProviders(r chi.Router) {
	face := h.ProvidersAdmin.Face
	r.Route("/providers", func(r chi.Router) {
		// 列表回的是**裸数组**(前端的 provider 本子直接 map 它),不包一层 —— 这个面上
		// 两种都有先例,选按调用方最省事的那种。
		r.Get("/", h.dispatchOp(face, "providers.list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "providers.create", bodyArgs, jsonCreated))
		r.Patch("/{id}",
			h.dispatchOp(face, "providers.update", bodyWithURLParam("id"), jsonOK))
		r.Delete("/{id}",
			h.dispatchOp(face, "providers.delete", urlParamArgs("id"), noContent))
		r.Post("/{id}/default",
			h.dispatchOp(face, "providers.set_default", urlParamArgs("id"), jsonOK))
		// models —— 「这条 provider 有哪些模型」。**owner 这一面不带 key**：服务端拿库里
		// 存的那把去问（F-R-11）。访客那条（`/api/v1/inference/models`）反过来，key 跟着
		// 请求进来 —— 那边没有 auth，调用方就是钥匙的持有人。
		r.Post("/{id}/models",
			h.dispatchOp(face, "providers.list_models", urlParamArgs("id"), jsonOK))
		r.Post("/models", h.dispatchOp(face, "providers.list_models", emptyArgs, jsonOK))
	})
}
