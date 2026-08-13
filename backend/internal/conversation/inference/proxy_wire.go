// proxy_wire.go —— pi-style wire ↔ eino schema 双向翻译 + SSE 帧
// 写出 helpers。拆出来让 proxy.go 守 max-lines / max-public-structs。

package inference

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/cloudwego/eino/schema"
	"github.com/eino-contrib/jsonschema"
)

const logErrKey = "err"

// toEinoMessages —— pi 风格 messages + system → []*schema.Message。
// system 作为 schema.System role 放在最前。assistant 调 tool 时的 tool_calls
// 跟 tool role 的 tool_call_id 1:1 翻给 eino schema (跟 OpenAI 同构)，
// 不再走 marker string。
func toEinoMessages(system string, in []ChatRequestMsg) ([]*schema.Message, error) {
	out := make([]*schema.Message, 0, len(in)+1)
	if system != "" {
		out = append(out, schema.SystemMessage(system))
	}
	for i := range in {
		role, rerr := einoRole(in[i].Role)
		if rerr != nil {
			return nil, rerr
		}
		// Never forward an assistant message with neither content nor tool_calls:
		// OpenAI-compatible providers (DeepSeek) 400 with "Invalid assistant
		// message: content or tool_calls must be set". A ReturnDirectly tool
		// (summarize_conversation) ends a turn on an artifact with no text, leaving
		// exactly such a message in history. Dropping it here — at the single
		// boundary every provider request crosses — means no "bad reply" can poison
		// the next turn of any conversation, whatever the history source.
		if isEmptyAssistant(role, &in[i]) {
			continue
		}
		out = append(out, &schema.Message{
			Role:       role,
			Content:    in[i].Content,
			ToolCalls:  toEinoToolCalls(in[i].ToolCalls),
			ToolCallID: in[i].ToolCallID,
		})
	}
	return out, nil
}

// isEmptyAssistant —— assistant turn carrying neither text nor a tool call. Such
// a message is invalid to send to the provider and meaningless to replay; it has
// no tool-call pairing to preserve, so it is always safe to drop.
func isEmptyAssistant(role schema.RoleType, m *ChatRequestMsg) bool {
	return role == schema.Assistant && m.Content == "" && len(m.ToolCalls) == 0
}

func toEinoToolCalls(in []ChatToolCallRef) []schema.ToolCall {
	out := make([]schema.ToolCall, 0, len(in))
	for i := range in {
		args := string(in[i].Args)
		if args == "" {
			args = "{}"
		}
		out = append(out, schema.ToolCall{
			ID: in[i].ID,
			Function: schema.FunctionCall{
				Name:      in[i].Name,
				Arguments: args,
			},
		})
	}
	return out
}

func einoRole(s string) (schema.RoleType, error) {
	switch s {
	case "user":
		return schema.User, nil
	case "assistant":
		return schema.Assistant, nil
	case "system":
		return schema.System, nil
	case "tool":
		return schema.Tool, nil
	}
	return "", fmt.Errorf("eino: unknown role %q", s)
}

// toEinoToolInfos —— pi tool spec (raw JSON schema) → eino schema.ToolInfo。
func toEinoToolInfos(in []ChatRequestTool) ([]*schema.ToolInfo, error) {
	out := make([]*schema.ToolInfo, 0, len(in))
	for i := range in {
		params, perr := newParamsFromRaw(in[i].InputSchema)
		info := &schema.ToolInfo{Name: in[i].Name, Desc: in[i].Description}
		if perr == nil {
			info.ParamsOneOf = params
		} else if !errors.Is(perr, errEmptyToolSchema) {
			return nil, perr
		}
		out = append(out, info)
	}
	return out, nil
}

// errEmptyToolSchema —— sentinel: 输入的 input_schema 为空 / 无 type，
// caller 把对应 ToolInfo.ParamsOneOf 留 nil。返这条 error 不算失败。
var errEmptyToolSchema = errors.New("eino: empty tool schema")

// newParamsFromRaw —— input_schema raw JSON → schema.ParamsOneOf 走
// eino-contrib/jsonschema.Schema (draft-07 兼容)。空 schema 返
// errEmptyToolSchema 哨兵；caller 通过 errors.Is 区分"无参数"跟"解析失败"。
func newParamsFromRaw(raw json.RawMessage) (*schema.ParamsOneOf, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errEmptyToolSchema
	}
	var js jsonschema.Schema
	if err := json.Unmarshal(raw, &js); err != nil {
		return nil, fmt.Errorf("eino: tool schema decode: %w", err)
	}
	if js.Type == "" {
		return nil, errEmptyToolSchema
	}
	return schema.NewParamsOneOfByJSONSchema(&js), nil
}

// toolCallCtx —— stream 期间累积 tool_call partial chunks。eino 在
// stream 模式下 tool_call.Function.Arguments 是逐 chunk 增量；按
// Index 聚合，stream 收尾时一次性 emit 完整 tool_call event。
type toolCallCtx struct {
	calls map[int]*pendingToolCall
}

type pendingToolCall struct {
	ID   string
	Name string
	Args string
}

func newToolCallCtx() *toolCallCtx {
	return &toolCallCtx{calls: map[int]*pendingToolCall{}}
}

// processChunk —— 一条 eino chunk：先 emit text delta；tool_call 累
// 积进 ctx 等收尾。
func processChunk(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	chunk *schema.Message, ctx *toolCallCtx,
) {
	if chunk.Content != "" {
		emitTextDelta(log, w, flusher, chunk.Content)
	}
	accumulateToolCalls(chunk.ToolCalls, ctx)
}

func emitTextDelta(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher, delta string,
) {
	body, err := json.Marshal(textDeltaPayload{Delta: delta})
	if err != nil {
		log.Error("proxy marshal text", logErrKey, err)
		return
	}
	writeSSEFrame(log, w, flusher, "text", body)
}

type textDeltaPayload struct {
	Delta string `json:"delta"`
}

type toolCallPayload struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type donePayload struct {
	StopReason string `json:"stop_reason"`
}

type errorPayloadShape struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func accumulateToolCalls(calls []schema.ToolCall, ctx *toolCallCtx) {
	for i := range calls {
		idx := callIndex(&calls[i])
		pc, ok := ctx.calls[idx]
		if !ok {
			pc = &pendingToolCall{}
			ctx.calls[idx] = pc
		}
		if calls[i].ID != "" {
			pc.ID = calls[i].ID
		}
		if calls[i].Function.Name != "" {
			pc.Name = calls[i].Function.Name
		}
		pc.Args += calls[i].Function.Arguments
	}
}

func callIndex(c *schema.ToolCall) int {
	if c.Index != nil {
		return *c.Index
	}
	return 0
}

// emitPendingToolCalls —— stream 收尾时把累积的 tool_call 全部 emit。
func emitPendingToolCalls(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	ctx *toolCallCtx,
) {
	for _, pc := range ctx.calls {
		input := json.RawMessage("{}")
		if pc.Args != "" {
			input = json.RawMessage(pc.Args)
		}
		body, err := json.Marshal(toolCallPayload{
			ID: pc.ID, Name: pc.Name, Input: input,
		})
		if err != nil {
			log.Error("proxy marshal tool_call", logErrKey, err)
			continue
		}
		writeSSEFrame(log, w, flusher, "tool_call", body)
	}
}

// mapFinishReason —— pi 风格 stop_reason 归一化。eino 跨 provider 返
// 两套风格的 finish_reason：
//
//   - Anthropic 原生 (claude adapter 直接透传)：tool_use / end_turn /
//     max_tokens / stop_sequence
//   - OpenAI 风格 (openai-compat adapter)：tool_calls / stop / length /
//     content_filter
//
// pi 协议只认 tool_use / end_turn / max_tokens 三种，其他统一掉 end_turn。
func mapFinishReason(r string) string {
	switch r {
	case "tool_use", "tool_calls":
		return "tool_use"
	case "max_tokens", "length":
		return "max_tokens"
	}
	return "end_turn"
}

// normalizedStop —— 发给客户端的收场值。产品自己判出来的那些**原样透传**;其余走上游归一化。
// 加一种产品判定就要在这儿加一行,否则它会被 mapFinishReason 的 default 静默改写成"说完了"。
func normalizedStop(r string) string {
	if r == StopClaimUnbacked {
		return r
	}
	return mapFinishReason(r)
}

// writeSSEFrame —— 一帧 SSE：`event: <type>\ndata: <body-json>\n\n` + flush。
// body 已 marshalled，调用方负责。
func writeSSEFrame(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	event string, body []byte,
) {
	if _, werr := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body); werr != nil {
		log.Error("proxy write", logErrKey, werr)
		return
	}
	if flusher != nil {
		flusher.Flush()
	}
}

// emitDone —— 收尾 done 帧。
func emitDone(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	finishReason string,
) {
	// 归一化只对**上游给的** finish reason 做。产品自己判出来的收场(claim_unbacked)已经是
	// wire 值,再过一遍 mapFinishReason 会被它的 default 分支抹成 end_turn —— 也就是后端刚
	// 判定"这一轮不算数",转手又告诉客户端"正常说完了"(F-A-37 修的时候就踩在这儿:闸门在日志
	// 里响了,访客那边什么都没有)。同一类塌陷,这是第二个点。
	body, err := json.Marshal(donePayload{StopReason: normalizedStop(finishReason)})
	if err != nil {
		log.Error("proxy marshal done", logErrKey, err)
		return
	}
	writeSSEFrame(log, w, flusher, "done", body)
}

// emitError —— 流中途的 SSE error 帧 (caller 内部用)。
func emitError(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher, err error,
) {
	cls := ClassifyStreamErr(err)
	// Raw error → log (ops); friendly text → user (never leak NodeRunError/stack).
	log.Warn("agent turn stream error", "code", cls.Code, logErrKey, err)
	payload := errorPayloadShape{Code: cls.Code, Message: FriendlyMessage(cls.Code)}
	body, merr := json.Marshal(payload)
	if merr != nil {
		log.Error("proxy marshal error", logErrKey, merr)
		return
	}
	writeSSEFrame(log, w, flusher, "error", body)
}

// writeProxyErr —— pre-stream 失败 (cred resolve / model build / msg
// 解析)：HTTP status + 一帧 SSE error 给浏览器，让它走 catch 路径。
func writeProxyErr(log *slog.Logger, w http.ResponseWriter, err error) {
	cls := ClassifyStreamErr(err)
	log.Error("proxy pre-stream", logErrKey, err, "code", cls.Code)
	setStreamSSEHeaders(w)
	w.WriteHeader(cls.Status)
	emitError(log, w, pickFlusher(w), err)
}
