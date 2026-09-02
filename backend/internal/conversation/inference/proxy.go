// proxy.go —— POST /api/v1/llm/chat/stream
//
// H.2: the new chat entry point; goes through eino's model.ToolCallingChatModel abstraction,
// provider-agnostic to the caller (the browser's pi-agent-core): both the request shape the
// backend receives and the SSE event stream it returns are in the pi unified form, independent
// of the specific provider (anthropic / openai-compat / gemini / ollama).
//
// Wire shape (shares its origin with the old /messages SSE from before G-Y.6):
//
//	POST body:
//	  {
//	    "system":   "...",
//	    "model":    "...",      // optional, fallback owner cred.Model
//	    "messages": [{role, content: string}],   // pi-style flat string content
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
// Coexists with the old /inference/stream (Anthropic native byte proxy). H.5 switches the
// browser's pi-agent-core to this one; H.3 deletes the old path.

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

// ChatRequest —— the browser's POST body.
// MaxTokens —— this call's output budget (0 = use the default). Only the turn's boundary
// synthesis sets it: it needs to synthesize twenty-odd evidence items into one passage on a
// reasoning model, and the default budget gets eaten entirely by thinking tokens, coming back
// with an empty body (measured in prod, F-A-40's item 5).
type ChatRequest struct {
	System    string            `json:"system"`
	Model     string            `json:"model,omitempty"`
	Messages  []ChatRequestMsg  `json:"messages"`
	Tools     []ChatRequestTool `json:"tools,omitempty"`
	MaxTokens int               `json:"max_tokens,omitempty"`
}

// ChatRequestMsg —— a pi-style flat-string message. When an assistant calls a tool, tool_calls
// is packed into that same message; a tool-role message carries tool_call_id to mark which
// tool_use it's answering. Isomorphic to OpenAI chat completions + eino schema.Message; proxy_wire
// translates it 1:1 into eino, no marker string involved anymore. Field order follows govet
// fieldalignment (4 strings first; slice after).
type ChatRequestMsg struct {
	Role       string            `json:"role"`
	Content    string            `json:"content"`
	ToolCallID string            `json:"tool_call_id,omitempty"`
	ToolCalls  []ChatToolCallRef `json:"tool_calls,omitempty"`
}

// ChatToolCallRef —— one tool_use invoked within an assistant turn. args is raw JSON (using
// RawMessage to preserve the caller's serialization exactly as-is).
type ChatToolCallRef struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

// ChatRequestTool —— a tool spec; input_schema is a raw JSON schema.
type ChatRequestTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// Stream —— the H.2 entry point. The caller (route handler) calls this once it has cred + req;
// the proxy handles the SSE headers + chunk emission itself.
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

// drainOneChunk —— reads one chunk, emits the matching SSE frame. Returns false when the
// stream has ended (EOF or error). On EOF, also emits pending tool_calls + a done frame.
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
