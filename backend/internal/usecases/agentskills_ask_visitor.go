// agentskills_ask_visitor.go —— I.1: ask_visitor capability.
//
// LLM 觉得 visitor 意图不明时，调 ask_visitor 抛一段结构化问题让 visitor
// 在 UI 上一键回 (radio / multi / yes_no + 可选 free chat)。tool 走 eino
// ADK ReturnDirectly —— 调完直接结束 agent loop，把 args echo 当 final
// 推浏览器；不再多转一圈 LLM。
//
// 数据回流：visitor 在 UI 点选项 + 可选 free-chat → 前端把选中项序列化
// 成下一条 user_message 喂 useChat.ask()，agent loop 自然进入下一轮，
// AI 看到 "(visitor chose: option-2)" 之类继续答。
//
// Mode 暴露：所有 mode 都暴露 (public / code / byoai)。AI 自决是否调；
// public visitor 的资源代价 = 一次额外 SSE 帧，不大。
//
// 无 deps：execute 就 echo args，不读 DB / 不算 quota / 不调 LLM。

package usecases

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/prompts"
)

const (
	capAskVisitor           = "ask_visitor"
	capAskVisitorFragmentID = "capabilities/ask_visitor"
	toolAskVisitorName      = "ask_visitor"
)

type askVisitorCapability struct{}

func newAskVisitorCapability() *askVisitorCapability {
	return &askVisitorCapability{}
}

func (*askVisitorCapability) ID() string { return capAskVisitor }
func (*askVisitorCapability) Shape() agentskills.Shape {
	return agentskills.ShapeVisitorOnly
}

func (*askVisitorCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{}
}

func (*askVisitorCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return capAskVisitorFragmentID
}

func (c *askVisitorCapability) SystemPromptFragment(
	ctx context.Context, in *agentskills.AssembleInput,
) string {
	id := c.SystemPromptFragmentID(ctx, in)
	if id == "" {
		return ""
	}
	return prompts.MustLoad(id)
}

func (*askVisitorCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return &agentskills.Binding{
		Tools: []agentskills.BindingTool{askVisitorBindingTool()},
		State: agentskills.CapabilityState{ID: capAskVisitor, Enabled: true},
	}, nil
}

func askVisitorBindingTool() agentskills.BindingTool {
	return agentskills.NewReturnDirectlyTool(
		toolAskVisitorName,
		"Ask the visitor a structured clarifying question when their intent "+
			"is ambiguous. Returns the question metadata; the visitor's choice "+
			"comes back as the next user message.",
		"asking visitor",
		json.RawMessage(askVisitorSchema),
		runAskVisitor,
	)
}

// askVisitorSchema —— tool input shape。kind=yes_no 不需 options
// (前端固定渲 Yes/No 两个按钮)；allow_chat 默认 false。
const askVisitorSchema = `{
  "type": "object",
  "properties": {
    "question": {
      "type": "string",
      "description": "The clarifying question, first-person."
    },
    "kind": {
      "type": "string",
      "enum": ["radio", "multi", "yes_no"],
      "description": "Widget kind. radio=pick one, multi=pick any, yes_no=fixed two options."
    },
    "options": {
      "type": "array",
      "items": {"type": "string"},
      "description": "2-6 short options for radio/multi; ignored for yes_no."
    },
    "allow_chat": {
      "type": "boolean",
      "description": "If true, show a free-text box alongside the widget."
    }
  },
  "required": ["question", "kind"]
}`

// runAskVisitor —— ReturnDirectly tool 的 RunFn。args 已经是 LLM 喂的合
// 法 JSON (eino schema validation 已挡非法)；echo 进 tool_result 让前
// 端按 kind dispatch 渲对应 widget。
//
// 不验 options 长度 / 不补 yes_no 的固定 [Yes,No] —— 前端按 kind 自渲。
// 后端只做 wire 转发，保持 capability 无 deps + 零业务。
func runAskVisitor(_ context.Context, argsJSON string) (string, error) {
	return argsJSON, nil
}
