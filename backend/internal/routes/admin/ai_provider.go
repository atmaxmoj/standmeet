// ai_provider.go —— admin /ai-provider：owner 设自己的推理 provider + 明文 key
// （落盘前 AES-GCM 加密），以及内置预设列表（填下拉 + 默认 endpoint/model）。
//
// 能力来自出站收口（通用件在 dispatch.go）。响应里没有 key —— 收口那侧的类型压根没有
// 这个字段，所以任何一个面都无从把它露出去，不是靠这里记得不写。
//
// 写入是**写下来的单面决定**：它带原始密钥，MCP 是纯 JSON 工具面，不承载这个。
// presets 是只读的，两个面都有。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// AIProviderDeps —— admin ai-provider 路由的能力来源。
type AIProviderDeps struct {
	Face *dispatcher.Face
}

// MountAIProvider 挂 PATCH /ai-provider + GET /ai-provider/presets。
func (h *Handlers) MountAIProvider(r chi.Router) {
	face := h.AIProviderAdmin.Face
	r.Patch("/ai-provider", h.dispatchOp(face, "ai_provider.set", bodyArgs, jsonOK))
	r.Get("/ai-provider/presets",
		h.dispatchOp(face, "ai_provider.presets", emptyArgs, jsonOK))
}
