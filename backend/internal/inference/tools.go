// tools.go —— provider 看见的 tool 抽象（Anthropic / OpenAI 同套形状）。
// 拆出来让 provider.go 守 max-public-structs 5 上限。

package inference

import (
	"context"
	"encoding/json"
)

// ToolSpec —— tools schema 的最小子集。InputSchema 是 JSON Schema object
// pre-marshalled bytes（key="type":"object","properties":{...},"required":[...]）。
// 用 RawMessage 让 provider 直接拼进 request body 不再 marshal，避免 `any` 跨层。
//
// ProgressLabel —— G-8: tool 跑过程中 frontend throbber 显的文案 ("searching
// corpus", "reading entry"...)。空 → frontend fallback "running <name>"。
// 由 backend single source 出，frontend ConversationDeck / ChatRoom 不再各
// 自硬编码 THROBBER_LABELS 表。
type ToolSpec struct {
	Name          string
	Description   string
	ProgressLabel string
	InputSchema   json.RawMessage
}

// ToolExecutor —— provider 在 agent loop 内调用 caller-provided 函数执行
// 一个 tool。input 是模型输出的 JSON arguments；返回 string text 进 tool_result。
type ToolExecutor func(ctx context.Context, name string, input []byte) (string, error)
