// openai_compat_tools.go —— OpenAI Chat Completions tool-use agent loop。
//
// 协议参考：https://platform.openai.com/docs/guides/function-calling
//
// 流程：
//   1. POST /v1/chat/completions stream=false with tools=[...]
//   2. response.choices[0].message：可能有 content + tool_calls
//      • content 非空 → emit 一坨 Chunk{Text}
//      • tool_calls 非空 → 每个 call 走 ExecuteTool；assistant message
//        (含 tool_calls) + 每个 tool result (role=tool, tool_call_id) 一起
//        append 进 conversation history，回到 1。
//   3. finish_reason != "tool_calls" → emit Done 退出。
//   4. ≤ maxAgentTurns 上限保护，超了报 Error 退出。
//
// 走 non-streaming 是因为 OpenAI tool_calls 在 SSE 里以 delta.tool_calls
// 增量拼起来，复杂度远高于 Anthropic。simple text 仍走流式（streamSimple）；
// 只在 tool path 退回 non-stream，把 finalized text 一次性 emit。

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const openAIMaxAgentTurns = 8

// runToolLoop —— OpenAI 版 agent loop。close(out) 在 defer 里。
func (p *OpenAICompatProvider) runToolLoop(
	ctx context.Context, req *ChatRequest, out chan<- Chunk,
) {
	defer close(out)
	msgs := initialOpenAIMessages(req)
	tools := convertOpenAITools(req.Tools)
	for range openAIMaxAgentTurns {
		turn, err := p.agentTurnOnce(ctx, req, msgs, tools, out)
		if err != nil {
			out <- Chunk{Error: err}
			return
		}
		msgs = append(msgs, turn.Assistant)
		if turn.FinishReason != openAIFinishToolCalls || len(turn.Assistant.ToolCalls) == 0 {
			out <- Chunk{Done: true}
			return
		}
		msgs = append(msgs, executeOpenAIToolCalls(ctx, req, turn.Assistant.ToolCalls)...)
	}
	out <- Chunk{Error: errors.New("openai agent loop: max turns exceeded")}
}

// oaTurnResult —— 一次 agent turn 解析完的产物。
// fieldalignment: struct 在前，string 在后。
type oaTurnResult struct {
	FinishReason string
	Assistant    oaMsg
}

// agentTurnOnce —— 一次 non-streaming POST + 解析 message。
// 把 content emit 出去（如果有），返 Assistant 消息（含 tool_calls）+
// finish_reason。
func (p *OpenAICompatProvider) agentTurnOnce(
	ctx context.Context, req *ChatRequest,
	msgs []oaMsg, tools []oaTool, out chan<- Chunk,
) (*oaTurnResult, error) {
	resp, err := p.openAgentOnce(ctx, req, msgs, tools)
	if err != nil {
		return nil, err
	}
	defer closeBody(resp.Body)
	return parseAgentResponse(resp.Body, out)
}

func (p *OpenAICompatProvider) openAgentOnce(
	ctx context.Context, req *ChatRequest, msgs []oaMsg, tools []oaTool,
) (*http.Response, error) {
	body, merr := json.Marshal(oaReq{
		Model:     pickOpenAIModel(req.Model, p.model),
		Messages:  msgs,
		Tools:     tools,
		MaxTokens: pickOpenAIMaxTokens(req.MaxTokens),
		Stream:    false,
	})
	if merr != nil {
		return nil, fmt.Errorf("openai agent marshal: %w", merr)
	}
	httpReq, herr := p.buildHTTPRequest(ctx, body)
	if herr != nil {
		return nil, herr
	}
	resp, derr := p.client.Do(httpReq)
	if derr != nil {
		return nil, normalizeNetErr(derr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, translateOpenAIStatus(resp)
	}
	return resp, nil
}

// oaChatResponse —— non-stream Chat Completions response wire shape。
type oaChatResponse struct {
	ID      string           `json:"id"`
	Choices []oaChatChoiceNS `json:"choices"`
}

type oaChatChoiceNS struct {
	FinishReason string `json:"finish_reason"`
	Message      oaMsg  `json:"message"`
	Index        int    `json:"index"`
}

// parseAgentResponse —— 解 non-stream response；emit content；返 turn result。
func parseAgentResponse(body io.Reader, out chan<- Chunk) (*oaTurnResult, error) {
	raw, rerr := io.ReadAll(body)
	if rerr != nil {
		return nil, fmt.Errorf("openai read response: %w", rerr)
	}
	var resp oaChatResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("openai unmarshal response: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("openai response: no choices")
	}
	choice := resp.Choices[0]
	if choice.Message.Content != "" {
		out <- Chunk{Text: choice.Message.Content}
	}
	choice.Message.Role = openAIRoleAssistant // 兜底；某些 provider 缺
	return &oaTurnResult{Assistant: choice.Message, FinishReason: choice.FinishReason}, nil
}

// initialOpenAIMessages —— 把 ChatRequest 转成首轮 oaMsg slice。
// system 走单独前缀（toOpenAIMessages 已经处理过同样的逻辑，这里复用）。
func initialOpenAIMessages(req *ChatRequest) []oaMsg {
	return toOpenAIMessages(req.System, req.Messages)
}

func convertOpenAITools(in []ToolSpec) []oaTool {
	out := make([]oaTool, 0, len(in))
	for i := range in {
		out = append(out, oaTool{
			Type: "function",
			Function: oaToolFunction{
				Name: in[i].Name, Description: in[i].Description,
				Parameters: in[i].InputSchema,
			},
		})
	}
	return out
}

// executeOpenAIToolCalls —— 每个 tool_call 走 caller-provided ExecuteTool；
// 每个 result 包成一条 role=tool message。失败 → JSON-encoded error string。
func executeOpenAIToolCalls(
	ctx context.Context, req *ChatRequest, calls []oaToolCall,
) []oaMsg {
	out := make([]oaMsg, 0, len(calls))
	for i := range calls {
		result, terr := req.ExecuteTool(ctx, calls[i].Function.Name,
			[]byte(calls[i].Function.Arguments))
		if terr != nil {
			result = fmt.Sprintf("{\"error\":%q}", terr.Error())
		}
		out = append(out, oaMsg{
			Role: openAIRoleTool, ToolCallID: calls[i].ID, Content: result,
		})
	}
	return out
}
