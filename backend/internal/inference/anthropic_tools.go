// anthropic_tools.go —— Anthropic tool-use agent loop。SSE 流式版本。
//
// Anthropic 协议参考：https://docs.anthropic.com/en/docs/build-with-claude/tool-use
//
// 流程：
//   1. POST /v1/messages with tools + stream=true
//   2. 解析 SSE：text_delta 直接 emit Chunk text；input_json_delta 累积到
//      对应 tool_use block 的 input 字段。
//   3. 收到 message_delta + stop_reason；finalize 当前 turn 的 content blocks。
//   4. stop_reason=="tool_use" → 执行所有 tool_use blocks，append 一条
//      user message 装 tool_result blocks，回到 1，循环 ≤ maxAgentTurns。
//   5. 其他 stop_reason → 推 Chunk{Done:true} 结束（text 已经流出去了）。
//
// SSE 解析逻辑落在 anthropic_sse.go 里（守 350-line max-lines）。

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const maxAgentTurns = 8

type anthropicAgentMsg struct {
	Role    string            `json:"role"`
	Content []anthropicABlock `json:"content"`
}

// anthropicABlock —— 通用 content block（text / tool_use / tool_result）。
// 字段全 optional，按 Type 决定哪些有意义；JSON 默认空字段省略。
type anthropicABlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   string          `json:"content,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
}

type anthropicAgentToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type anthropicAgentReq struct {
	Model     string                  `json:"model"`
	System    string                  `json:"system,omitempty"`
	Messages  []anthropicAgentMsg     `json:"messages"`
	Tools     []anthropicAgentToolDef `json:"tools"`
	MaxTokens int                     `json:"max_tokens"`
	Stream    bool                    `json:"stream"`
}

func (a *AnthropicProvider) runToolLoop(
	ctx context.Context, req *ChatRequest, out chan<- Chunk,
) {
	defer close(out)
	msgs := initialAgentMessages(req)
	tools := convertToolSpecs(req.Tools)
	for range maxAgentTurns {
		turn, err := a.agentTurnStream(ctx, req, msgs, tools, out)
		if err != nil {
			out <- Chunk{Error: err}
			return
		}
		msgs = append(msgs, anthropicAgentMsg{Role: "assistant", Content: turn.Blocks})
		if turn.StopReason != "tool_use" {
			out <- Chunk{Done: true}
			return
		}
		toolMsgs := executeToolUses(ctx, req, turn.Blocks)
		msgs = append(msgs, anthropicAgentMsg{Role: "user", Content: toolMsgs})
	}
	out <- Chunk{Error: errors.New("anthropic agent loop: max turns exceeded")}
}

func initialAgentMessages(req *ChatRequest) []anthropicAgentMsg {
	out := make([]anthropicAgentMsg, 0, len(req.Messages))
	for i := range req.Messages {
		if req.Messages[i].Role == "system" {
			continue
		}
		out = append(out, anthropicAgentMsg{
			Role:    req.Messages[i].Role,
			Content: []anthropicABlock{{Type: "text", Text: req.Messages[i].Content}},
		})
	}
	return out
}

func convertToolSpecs(in []ToolSpec) []anthropicAgentToolDef {
	out := make([]anthropicAgentToolDef, 0, len(in))
	for i := range in {
		out = append(out, anthropicAgentToolDef{
			Name: in[i].Name, Description: in[i].Description,
			InputSchema: in[i].InputSchema,
		})
	}
	return out
}

// agentTurnStream —— 一次 streaming 请求 + SSE parse。
// 返 AgentTurnResult (blocks + stop_reason) 避开 3-return。
// text deltas 已经在 SSE 期间 emit 给 out channel。
func (a *AnthropicProvider) agentTurnStream(
	ctx context.Context, req *ChatRequest,
	msgs []anthropicAgentMsg, tools []anthropicAgentToolDef,
	out chan<- Chunk,
) (*AgentTurnResult, error) {
	resp, err := a.openAgentStream(ctx, req, msgs, tools)
	if err != nil {
		return nil, err
	}
	defer closeBody(resp.Body)
	return parseAnthropicAgentSSE(resp.Body, out)
}

func (a *AnthropicProvider) openAgentStream(
	ctx context.Context, req *ChatRequest,
	msgs []anthropicAgentMsg, tools []anthropicAgentToolDef,
) (*http.Response, error) {
	body, merr := json.Marshal(anthropicAgentReq{
		Model: pickAnthropicModel(req.Model, a.model), System: req.System,
		Messages: msgs, Tools: tools,
		MaxTokens: pickAnthropicMaxTokens(req.MaxTokens), Stream: true,
	})
	if merr != nil {
		return nil, fmt.Errorf("anthropic agent marshal: %w", merr)
	}
	httpReq, herr := a.buildHTTPRequest(ctx, body)
	if herr != nil {
		return nil, herr
	}
	resp, derr := a.client.Do(httpReq)
	if derr != nil {
		return nil, normalizeNetErr(derr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, translateAnthropicStatusFromBody(resp)
	}
	return resp, nil
}

// translateAnthropicStatusFromBody —— translateAnthropicStatus 已经关 body，
// agent-loop 这边自己拥有 body 生命周期。
func translateAnthropicStatusFromBody(resp *http.Response) error {
	defer closeBody(resp.Body)
	bodyText, rerr := io.ReadAll(resp.Body)
	if rerr != nil {
		bodyText = []byte("(read body err)")
	}
	if sentinel := statusSentinel(resp.StatusCode); sentinel != nil {
		return sentinel
	}
	if resp.StatusCode == http.StatusBadRequest {
		return classifyAnthropic400(string(bodyText))
	}
	if resp.StatusCode >= httpServerErrorBoundary {
		return ErrServerSide
	}
	return fmt.Errorf("anthropic %d: %s", resp.StatusCode, string(bodyText))
}

func executeToolUses(
	ctx context.Context, req *ChatRequest, blocks []anthropicABlock,
) []anthropicABlock {
	out := make([]anthropicABlock, 0)
	for i := range blocks {
		if blocks[i].Type != "tool_use" {
			continue
		}
		result, terr := req.ExecuteTool(ctx, blocks[i].Name, []byte(blocks[i].Input))
		if terr != nil {
			result = fmt.Sprintf("{\"error\":%q}", terr.Error())
		}
		out = append(out, anthropicABlock{
			Type: "tool_result", ToolUseID: blocks[i].ID, Content: result,
		})
	}
	return out
}
