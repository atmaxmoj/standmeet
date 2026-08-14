// api_keys.go —— admin /api-keys endpoint(列表 / 铸 / 吊销 / 改标签与限速)。
//
// **为什么这个面必须存在**(F-K-1):在它之前,外发 key 只长在 owner-MCP 上,于是一把泄露的
// key **只有在 owner 装好并跑起一个 MCP 客户端之后才吊销得掉**。止血的路不能要求先装工具。
// 设计本来就要两个面互为孪生(`docs/design/facade-directions.md:202-206`:admin HTTP 的
// `/api/admin/api-keys` CRUD + revoke,加 admin 的 api 区),缺的一直是这一半。
//
// 能力来自出站收口(通用件在 dispatch.go);这个面只决定 REST 形状:资源 id 走路径,其余进 body。
// 铸出来那一次会带上**明文 secret**,而且只有那一次 —— 之后列表里只剩前缀。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// APIKeysAdminDeps —— admin api-keys handlers 的能力来源。
type APIKeysAdminDeps struct {
	Face *dispatcher.Face
}

// MountAPIKeys 挂 /api-keys 子路由。
func (h *Handlers) MountAPIKeys(r chi.Router) {
	face := h.APIKeysAdmin.Face
	r.Get("/api-keys", h.dispatchOp(face, "api_keys.list", emptyArgs, jsonOK))
	r.Post("/api-keys", h.dispatchOp(face, "api_keys.create", bodyArgs, jsonOK))
	r.Patch("/api-keys/{id}", h.dispatchOp(face, "api_keys.update", bodyWithURLParam("id"), jsonOK))
	r.Post("/api-keys/{id}/revoke",
		h.dispatchOp(face, "api_keys.revoke", urlParamArgs("id"), jsonOK))
}
