// proxy.go —— POST /api/v1/llm/chat/stream
//
// H.2: 新 chat 入口；走 eino model.ToolCallingChatModel 抽象，对调用方
// (浏览器 pi-agent-core) provider-agnostic：backend 收到的请求 shape
// 跟返回的 SSE 事件流都是 pi unified 形态，跟具体 provider (anthropic /
// openai-compat / gemini / ollama) 无关。
//
// Wire 形态 (与 G-Y.6 之前的老 /messages SSE 同源)：
//
//	POST body:
//	  {
//	    "system":   "...",
//	    "model":    "...",      // optional, fallback owner cred.Model
//	    "messages": [{role, content: string}],   // pi-style 平字符串
//	    "tools":    [{name, description, input_schema}]
//	  }
//
//	Response: text/event-stream
//	  event: text
//	  data: {"delta": "Hello"}
//
//	  event: tool_call
//	  data: {"id":"...","name":"...","input":{...}}
//
//	  event: done
//	  data: {"stop_reason": "end_turn|tool_use|max_tokens"}
//
//	  event: error
//	  data: {"code":"...","message":"..."}
//
// 跟老 /inference/stream (Anthropic native byte proxy) 并存。H.5 浏览器
// pi-agent-core 切到这条；H.3 删老 path。

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// ChatRequest —— 浏览器 POST 的 body。
type ChatRequest struct {
	System   string            `json:"system"`
	Model    string            `json:"model,omitempty"`
	Messages []ChatRequestMsg  `json:"messages"`
	Tools    []ChatRequestTool `json:"tools,omitempty"`
}

// ChatRequestMsg —— pi 风格平字符串消息。assistant 调 tool 时把 tool_calls
// 装进当条消息；tool role 携带 tool_call_id 标明回应哪条 tool_use。形态
// 跟 OpenAI chat completions + eino schema.Message 同构，proxy_wire 1:1
// 翻给 eino，不再走 marker string。字段顺序按 govet fieldalignment 排
// (4 string 在前；slice 在后)。
type ChatRequestMsg struct {
	Role       string            `json:"role"`
	Content    string            `json:"content"`
	ToolCallID string            `json:"tool_call_id,omitempty"`
	ToolCalls  []ChatToolCallRef `json:"tool_calls,omitempty"`
}

// ChatToolCallRef —— assistant turn 当中调出的一条 tool_use。args 是
// raw JSON (用 RawMessage 保 caller 序列化原样)。
type ChatToolCallRef struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

// ChatRequestTool —— tool spec; input_schema 是 raw JSON schema。
type ChatRequestTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// Stream —— H.2 entry point。caller (route handler) 拿到 cred + req 后
// 调这个，proxy 自己负责 SSE header + chunk emission。
func Stream(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	cred *Cred, req *ChatRequest,
) {
	cm, err := buildAndAttachTools(ctx, cred, req)
	if err != nil {
		writeProxyErr(log, w, err)
		return
	}
	einoMsgs, merr := toEinoMessages(req.System, req.Messages)
	if merr != nil {
		writeProxyErr(log, w, merr)
		return
	}
	streamReader, serr := cm.Stream(ctx, einoMsgs)
	if serr != nil {
		writeProxyErr(log, w, serr)
		return
	}
	defer streamReader.Close()
	setStreamSSEHeaders(w)
	forwardEinoStream(log, w, streamReader)
}

//nolint:ireturn // returns the eino interface BuildChatModel exposes
func buildAndAttachTools(
	ctx context.Context, cred *Cred, req *ChatRequest,
) (model.ToolCallingChatModel, error) {
	cm, err := BuildChatModel(ctx, pickModelCred(cred, req.Model))
	if err != nil {
		return nil, err
	}
	if len(req.Tools) == 0 {
		return cm, nil
	}
	return attachTools(cm, req.Tools)
}

func pickModelCred(cred *Cred, override string) *Cred {
	if override == "" {
		return cred
	}
	out := *cred
	out.Model = override
	return &out
}

//nolint:ireturn // returns the same eino interface as BuildChatModel
func attachTools(
	cm model.ToolCallingChatModel, tools []ChatRequestTool,
) (model.ToolCallingChatModel, error) {
	toolInfos, terr := toEinoToolInfos(tools)
	if terr != nil {
		return nil, terr
	}
	with, werr := cm.WithTools(toolInfos)
	if werr != nil {
		return nil, fmt.Errorf("eino: with tools: %w", werr)
	}
	return with, nil
}

func setStreamSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
}

func forwardEinoStream(
	log *slog.Logger, w http.ResponseWriter,
	stream *schema.StreamReader[*schema.Message],
) {
	flusher := pickFlusher(w)
	state := &streamState{ctx: newToolCallCtx()}
	for {
		if !drainOneChunk(log, w, flusher, stream, state) {
			return
		}
	}
}

func pickFlusher(w http.ResponseWriter) http.Flusher {
	if f, ok := w.(http.Flusher); ok {
		return f
	}
	return nil
}

type streamState struct {
	ctx          *toolCallCtx
	finishReason string
}

// drainOneChunk —— 读一条 chunk，emit 对应 SSE 帧。返 false 表示流终止
// (EOF 或 error)。EOF 时同时 emit pending tool_calls + done 帧。
func drainOneChunk(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	stream *schema.StreamReader[*schema.Message], state *streamState,
) bool {
	chunk, err := stream.Recv()
	if errors.Is(err, io.EOF) {
		emitPendingToolCalls(log, w, flusher, state.ctx)
		emitDone(log, w, flusher, state.finishReason)
		return false
	}
	if err != nil {
		emitError(log, w, flusher, err)
		return false
	}
	processChunk(log, w, flusher, chunk, state.ctx)
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.FinishReason != "" {
		state.finishReason = chunk.ResponseMeta.FinishReason
	}
	return true
}
