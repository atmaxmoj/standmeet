// mcp_servers.go —— admin /mcp-servers：list / create / check / delete + dep-grant。
//
// 能力来自出站收口（通用件在 dispatch.go）。delete 和 dep-grant 历史上回 204 空身，
// 前端按这个契约写的，所以继续回 204 —— 状态码是本面的决定，载荷是收口那一份。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MCPServersAdminDeps —— admin mcp-servers handlers 的能力来源。
type MCPServersAdminDeps struct {
	Face *dispatcher.Face
}

// MountMCPServers 挂 /mcp-servers。owner-registered server CRUD；
// mcp server 通过 role_mcp_servers 挂 role（A.3-IAM-5 起不再直接挂 code）。
func (h *Handlers) MountMCPServers(r chi.Router) {
	face := h.MCPServersAdmin.Face
	r.Route("/mcp-servers", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "mcp_server_list", emptyArgs, jsonOK))
		r.Post("/", h.dispatchOp(face, "mcp_server_create", bodyArgs, jsonCreated))
		// POST 而不是 GET：它对外拨一次号。读语义（什么都不改），但**有副作用地贵**，
		// 不该被任何一层当成可缓存、可预取的 GET。
		r.Post("/{server_id}/check",
			h.dispatchOp(face, "mcp_server_check", urlParamArgs("server_id"), jsonOK))
		r.Delete("/{server_id}",
			h.dispatchOp(face, "mcp_server_delete", urlParamArgs("server_id"), noContent))
		// owner 显式授权这台 ext-mcp server 接某 connector 依赖（最低信任，默认拒）。
		r.Post("/{server_id}/dep-grants",
			h.dispatchOp(face, "mcp_server_grant_dep",
				bodyWithURLParam("server_id"), noContent))
	})
}
