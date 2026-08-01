// conversations.go —— /api/admin/conversations/* + /api/admin/ghosts/telemetry。
//
// 能力来自出站收口（通用件在 dispatch.go）；这个面只决定 REST 形状：列表在
// /conversations，一份逐字稿在 /conversations/{id}，遥测在 /ghosts/telemetry。
//
// 迁移前一份逐字稿两个面各建一份：这边有 refs 和 ghost 日志、MCP 那边有被引条目的正文，
// 谁也不是谁的子集。现在是同一份载荷。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// ConversationsDeps —— admin conversations handlers 的能力来源。
type ConversationsDeps struct {
	Face *dispatcher.Face
}

// MountConversations 挂 /conversations + ghost 遥测路由。
func (h *Handlers) MountConversations(r chi.Router) {
	face := h.Conversations.Face
	r.Get("/conversations", h.dispatchOp(face, "conversations.list",
		queryArgsRenamed(map[string]string{}, "limit"), jsonOK))
	r.Get("/conversations/{conversation_id}", h.dispatchOp(face, "conversations.get",
		urlParamArgs("conversation_id"), jsonOK))
	r.Get("/ghosts/telemetry", h.dispatchOp(face, "conversations.ghost_telemetry",
		emptyArgs, jsonOK))
}
