// anthropic_tools.go —— Anthropic tool-use agent loop。
//
// Anthropic 协议参考：https://docs.anthropic.com/en/docs/build-with-claude/tool-use
//
// 流程：
//   1. POST /v1/messages with tools + messages（stream=false 简化 input_json_delta 累积）
//   2. response.content 是 content blocks 数组（text + tool_use 混合）
//   3. stop_reason == "tool_use"：
//        a. 把 assistant content (含 tool_use blocks) 整段加进 messages
//        b. 对每个 tool_use 调 ExecuteTool 拿 result
//        c. 加一条 user message 装所有 tool_result blocks
//        d. 回到 1，循环 ≤ maxAgentTurns
//   4. stop_reason != "tool_use"：取所有 text block 拼成 final answer，
//      切 chunk 推回 channel（前端"流"——但不是真 server-side stream，
//      只是把 final text 切片，给 SSE 一个 chunky feel）。

package inference

import (
	"bytes"
	"context"
	"encoding/json"
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
// 字段顺序按 fieldalignment：slice/RawMessage 在尾。
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
}

type anthropicAgentResp struct {
	StopReason string            `json:"stop_reason"`
	Content    []anthropicABlock `json:"content"`
}

func (a *AnthropicProvider) runToolLoop(
	ctx context.Context, req *ChatRequest, out chan<- Chunk,
) {
	defer close(out)
	msgs := initialAgentMessages(req)
	tools := convertToolSpecs(req.Tools)
	for range maxAgentTurns {
		resp, err := a.agentTurn(ctx, req, msgs, tools)
		if err != nil {
			out <- Chunk{Error: err}
			return
		}
		msgs = append(msgs, anthropicAgentMsg{Role: "assistant", Content: resp.Content})
		if resp.StopReason != "tool_use" {
			emitTextChunks(extractText(resp.Content), out)
			return
		}
		toolMsgs := executeToolUses(ctx, req, resp.Content)
		msgs = append(msgs, anthropicAgentMsg{Role: "user", Content: toolMsgs})
	}
	out <- Chunk{Error: fmt.Errorf("anthropic agent loop: max %d turns exceeded", maxAgentTurns)}
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

func (a *AnthropicProvider) agentTurn(
	ctx context.Context, req *ChatRequest,
	msgs []anthropicAgentMsg, tools []anthropicAgentToolDef,
) (*anthropicAgentResp, error) {
	body, merr := json.Marshal(anthropicAgentReq{
		Model: pickAnthropicModel(req.Model, a.model), System: req.System,
		Messages: msgs, Tools: tools,
		MaxTokens: pickAnthropicMaxTokens(req.MaxTokens),
	})
	if merr != nil {
		return nil, fmt.Errorf("anthropic agent marshal: %w", merr)
	}
	httpReq, herr := a.buildHTTPRequest(ctx, body)
	if herr != nil {
		return nil, herr
	}
	httpReq.Header.Del("Accept") // non-stream → application/json
	resp, derr := a.client.Do(httpReq)
	if derr != nil {
		return nil, normalizeNetErr(derr)
	}
	defer closeBody(resp.Body)
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, translateAnthropicStatusFromBody(resp)
	}
	return decodeAgentResp(resp.Body)
}

func decodeAgentResp(r io.Reader) (*anthropicAgentResp, error) {
	var out anthropicAgentResp
	if derr := json.NewDecoder(r).Decode(&out); derr != nil {
		return nil, fmt.Errorf("anthropic agent decode: %w", derr)
	}
	return &out, nil
}

// translateAnthropicStatusFromBody —— translateAnthropicStatus 已经关 body，
// agent-loop 这边自己拥有 body 生命周期。
func translateAnthropicStatusFromBody(resp *http.Response) error {
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

func extractText(blocks []anthropicABlock) string {
	var b bytes.Buffer
	for i := range blocks {
		if blocks[i].Type == "text" {
			_, _ = b.WriteString(blocks[i].Text)
		}
	}
	return b.String()
}

// emitTextChunks —— final text 不是真 streaming（agent loop 用非流式 endpoint）；
// 切成单词 chunk 给前端制造流式体感。
func emitTextChunks(text string, out chan<- Chunk) {
	if text == "" {
		out <- Chunk{Done: true}
		return
	}
	// 按 space split 后保留分隔；跟 mock provider 节奏对齐。
	from := 0
	for i := range len(text) {
		if text[i] == ' ' {
			out <- Chunk{Text: text[from : i+1]}
			from = i + 1
		}
	}
	if from < len(text) {
		out <- Chunk{Text: text[from:]}
	}
	out <- Chunk{Done: true}
}
