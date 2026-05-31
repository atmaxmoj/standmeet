// inference_stream.go —— POST /api/v1/inference/stream
//
// Phase D 主路径：browser pi-agent-core 跑 agent loop 时每轮调一次
// 拿 LLM single-turn 输出。Body { system, messages, tools[]? }；
// Auth Bearer visitor session token；Response SSE events:
//   - text: { delta: "..." }
//   - tool_call: { id, name, input }
//   - done: { stop_reason }
//   - error: { message }
//
// provider 走既有 Resolver (跟 /messages 同一路径)；ExecuteTool 不填，
// 单轮不在 backend 执行 tool —— pi-agent-core 拿 tool_call event 后自己
// 通过 /sessions/{id}/tools/{name} 调。

package public

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/session"
)

// inferenceStreamRequest —— POST /api/v1/inference/stream 入参。
// 字段顺序按 fieldalignment (slices 先，长 strings 后) lint 调好。
type inferenceStreamRequest struct {
	System   string                  `json:"system"`
	Model    string                  `json:"model,omitempty"`
	Messages []inferenceStreamMsg    `json:"messages"`
	Tools    []inferenceStreamToolIn `json:"tools,omitempty"`
}

type inferenceStreamMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type inferenceStreamToolIn struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

func (h *Handlers) inferenceStream() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := authVisitorWithToken(h, w, r)
		if !ok {
			return
		}
		var req inferenceStreamRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runInferenceStream(r.Context(), h, w, r, &inferenceStreamArgs{
			Data: auth.Data, Token: auth.Token, Req: &req,
		})
	}
}

type inferenceStreamArgs struct {
	Data  *session.VisitorSessionData
	Req   *inferenceStreamRequest
	Token string
}

func runInferenceStream(
	ctx context.Context, h *Handlers, w http.ResponseWriter, r *http.Request,
	args *inferenceStreamArgs,
) {
	provider, perr := resolveStreamProvider(ctx, h, args, r)
	if perr != nil {
		writeStreamErr(h.Log, w, perr)
		return
	}
	ch, serr := provider.StreamSingleTurn(ctx, buildStreamChatRequest(args.Req))
	if serr != nil {
		writeStreamErr(h.Log, w, serr)
		return
	}
	pumpStreamEvents(ctx, h.Log, w, ch)
}

func resolveStreamProvider(
	ctx context.Context, h *Handlers, args *inferenceStreamArgs, r *http.Request,
) (inference.Provider, error) {
	byoai := pickStreamBYOAICred(h, args, r)
	return h.Visitor.Resolver.Resolve(ctx, &inference.ResolveInput{
		OwnerID: args.Data.OwnerID, Mode: args.Data.Mode, BYOAI: byoai,
	})
}

// pickStreamBYOAICred —— byoai mode 时复用 readBYOAICredFromHeaders。其他
// mode 返 nil 让 resolver 走 owner key。读 header 失败时 readBYOAICred
// 自己 write 401 + 返 nil；caller 用 sentinel error 把上游 resolve 短路。
func pickStreamBYOAICred(
	h *Handlers, args *inferenceStreamArgs, r *http.Request,
) *domain.AICredential {
	if args.Data.Mode != "byoai" {
		return nil
	}
	cred, _ := readBYOAICredFromHeaders(h, &nopResponseWriter{}, r, args.Token)
	return cred
}

// nopResponseWriter —— readBYOAICredFromHeaders 在缺 header 时会 write 401，
// 但 inference_stream 想自己控制响应。这个 nop 吃掉那个 write，让 caller
// 拿 nil cred 后走 resolver 失败路径 (resolver 没 BYOAI cred + mode=byoai
// 时返 ErrOwnerProviderUnconfigured)。
type nopResponseWriter struct{}

func (*nopResponseWriter) Header() http.Header         { return http.Header{} }
func (*nopResponseWriter) Write(b []byte) (int, error) { return len(b), nil }
func (*nopResponseWriter) WriteHeader(_ int)           {}

func buildStreamChatRequest(req *inferenceStreamRequest) *inference.ChatRequest {
	msgs := make([]inference.Message, 0, len(req.Messages))
	for i := range req.Messages {
		msgs = append(msgs, inference.Message{
			Role: req.Messages[i].Role, Content: req.Messages[i].Content,
		})
	}
	tools := make([]inference.ToolSpec, 0, len(req.Tools))
	for i := range req.Tools {
		tools = append(tools, inference.ToolSpec{
			Name:        req.Tools[i].Name,
			Description: req.Tools[i].Description,
			InputSchema: req.Tools[i].InputSchema,
		})
	}
	return &inference.ChatRequest{
		Model: req.Model, System: req.System,
		Messages: msgs, Tools: tools,
	}
}

func pumpStreamEvents(
	ctx context.Context, log *slog.Logger,
	w http.ResponseWriter, ch <-chan inference.StreamEvent,
) {
	setSSEHeaders(w)
	streamLoop(ctx, log, w, asFlusher(w), ch)
}

// asFlusher —— 安全做 http.Flusher 类型断言。errcheck 把
// `flusher, _ := w.(http.Flusher)` 也当 ignored return。
func asFlusher(w http.ResponseWriter) http.Flusher {
	if f, ok := w.(http.Flusher); ok {
		return f
	}
	return nil
}

func setSSEHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
}

func streamLoop(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	flusher http.Flusher, ch <-chan inference.StreamEvent,
) {
	for streamLoopOne(ctx, log, w, flusher, ch) {
	}
}

// streamLoopOne —— 处理一个 event；返 true 继续 loop，false 退出。
func streamLoopOne(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter,
	flusher http.Flusher, ch <-chan inference.StreamEvent,
) bool {
	ev, ok := nextEvent(ctx, ch)
	if !ok {
		return false
	}
	writeStreamEvent(log, w, flusher, &ev)
	return !isTerminalEvent(&ev)
}

func nextEvent(
	ctx context.Context, ch <-chan inference.StreamEvent,
) (inference.StreamEvent, bool) {
	select {
	case <-ctx.Done():
		return inference.StreamEvent{}, false
	case ev, ok := <-ch:
		return ev, ok
	}
}

func isTerminalEvent(ev *inference.StreamEvent) bool {
	return ev.Type == "done" || ev.Type == "error"
}

func writeStreamEvent(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	ev *inference.StreamEvent,
) {
	payload, err := marshalStreamEvent(ev)
	if err != nil {
		log.Error("inference stream marshal", "err", err)
		return
	}
	flushStreamFrame(log, w, flusher, ev.Type, payload)
}

func flushStreamFrame(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	evType string, payload []byte,
) {
	if _, werr := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evType, payload); werr != nil {
		log.Error("inference stream write", "err", werr)
		return
	}
	if flusher != nil {
		flusher.Flush()
	}
}

// streamEventMarshalers —— ev.Type → payload marshaler。dispatch table 避
// 让 marshalStreamEvent 自己 switch (lint cyclo cap)。
var streamEventMarshalers = map[string]func(*inference.StreamEvent) ([]byte, error){
	"text":      marshalTextEvent,
	"tool_call": marshalToolCallEventWrap,
	"done":      marshalDoneEvent,
	"error":     marshalErrorEvent,
}

func marshalStreamEvent(ev *inference.StreamEvent) ([]byte, error) {
	if fn, ok := streamEventMarshalers[ev.Type]; ok {
		return fn(ev)
	}
	return json.Marshal(map[string]string{"type": ev.Type})
}

func marshalTextEvent(ev *inference.StreamEvent) ([]byte, error) {
	return json.Marshal(map[string]string{"delta": ev.Text})
}

func marshalToolCallEventWrap(ev *inference.StreamEvent) ([]byte, error) {
	return marshalToolCallEvent(ev.ToolCall)
}

func marshalDoneEvent(ev *inference.StreamEvent) ([]byte, error) {
	return json.Marshal(map[string]string{"stop_reason": ev.Stop})
}

func marshalErrorEvent(ev *inference.StreamEvent) ([]byte, error) {
	return json.Marshal(map[string]string{"message": errString(ev.Err)})
}

// toolCallWire —— tool_call event JSON shape (跟前端 agent-core 解析对齐)。
type toolCallWire struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

func marshalToolCallEvent(call *inference.StreamToolCall) ([]byte, error) {
	if call == nil {
		return []byte(`{}`), nil
	}
	return json.Marshal(toolCallWire{
		ID: call.ID, Name: call.Name, Input: json.RawMessage(call.Input),
	})
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func writeStreamErr(log *slog.Logger, w http.ResponseWriter, err error) {
	var sentinel error
	switch {
	case errors.Is(err, inference.ErrInvalidAPIKey):
		sentinel = inference.ErrInvalidAPIKey
		http.Error(w, "invalid api key", http.StatusUnauthorized)
	case errors.Is(err, inference.ErrOwnerProviderUnconfigured):
		sentinel = inference.ErrOwnerProviderUnconfigured
		http.Error(w, "owner ai not configured", http.StatusServiceUnavailable)
	default:
		http.Error(w, "inference stream error: "+err.Error(), http.StatusInternalServerError)
	}
	log.Error("inference stream error", "err", err, "sentinel", sentinel)
}
