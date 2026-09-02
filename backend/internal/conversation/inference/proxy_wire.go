// proxy_wire.go —— bidirectional translation between the pi-style wire format ↔ eino schema,
// plus SSE frame-writing helpers. Split out so proxy.go stays under max-lines /
// max-public-structs.

package inference

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"

	"github.com/cloudwego/eino/schema"
	"github.com/eino-contrib/jsonschema"
)

const logErrKey = "err"

// toEinoMessages —— pi-style messages + system → []*schema.Message. system is placed first as
// the schema.System role. When an assistant calls a tool, its tool_calls and the tool role's
// tool_call_id are translated 1:1 into eino schema (isomorphic to OpenAI), no marker string
// involved anymore.
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

// toEinoToolInfos —— a pi tool spec (raw JSON schema) → eino schema.ToolInfo.
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

// errEmptyToolSchema —— sentinel: the input input_schema is empty / has no type; the caller
// leaves the matching ToolInfo.ParamsOneOf nil. Returning this error doesn't count as a
// failure.
var errEmptyToolSchema = errors.New("eino: empty tool schema")

// newParamsFromRaw —— input_schema raw JSON → schema.ParamsOneOf, going through
// eino-contrib/jsonschema.Schema (draft-07 compatible). An empty schema returns the
// errEmptyToolSchema sentinel; the caller uses errors.Is to distinguish "no parameters" from
// "parse failure".
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

// toolCallCtx —— accumulates partial tool_call chunks during streaming. In stream mode eino
// returns tool_call.Function.Arguments incrementally, chunk by chunk; aggregated by Index, then
// emitted as a complete tool_call event once at stream end.
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

// processChunk —— one eino chunk: emits the text delta first; tool_call is accumulated into
// ctx and handled at wrap-up.
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

// emitPendingToolCalls —— at stream wrap-up, emits every accumulated tool_call.
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

// mapFinishReason —— normalizes to a pi-style stop_reason. eino returns two different styles
// of finish_reason across providers:
//
//   - Anthropic native (the claude adapter passes it through directly): tool_use / end_turn /
//     max_tokens / stop_sequence
//   - OpenAI style (the openai-compat adapter): tool_calls / stop / length / content_filter
//
// The pi protocol only recognizes three kinds — tool_use / end_turn / max_tokens — everything
// else collapses to end_turn.
func mapFinishReason(r string) string {
	switch r {
	case "tool_use", "tool_calls":
		return "tool_use"
	case "max_tokens", "length":
		return "max_tokens"
	}
	return "end_turn"
}

// productStops —— stop reasons **the product itself judged**. They don't come from the
// upstream provider, so they must never go through `mapFinishReason` — that function's default
// branch would silently rewrite an unrecognized value into "finished normally".
//
// This list exists in exactly one place: it used to be a chain of `||` with a comment next to
// it saying "add one more kind, add one more line here" — and that reminder didn't stop the
// F-A-35 omission (the backend judged correctly, the frontend had the code too, but this exact
// hop rewrote it into end_turn, the prompt just never rendered, and no layer raised an error).
// Adding a new stop reason now only requires adding to this slice, and both places follow along
// automatically ([[structure-means-no-responsibility-class]]).
var productStops = []string{StopClaimUnbacked, StopNoAnswer, StopDeadline}

func normalizedStop(r string) string {
	if slices.Contains(productStops, r) {
		return r
	}
	return mapFinishReason(r)
}

// writeSSEFrame —— one SSE frame: `event: <type>\ndata: <body-json>\n\n` + flush. body is
// already marshalled; that's the caller's responsibility.
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

// emitDone —— the wrap-up done frame.
func emitDone(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	finishReason string,
) {
	// Normalization only applies to a finish reason **given by upstream**. A stop reason the
	// product judged itself (claim_unbacked) is already a wire value; running it through
	// mapFinishReason again would get it erased into end_turn by that function's default
	// branch — i.e. the backend just decided "this turn doesn't count", then immediately turns
	// around and tells the client "finished normally" (F-A-37's fix stepped on exactly this:
	// the gate fired in the logs, and the visitor's side saw nothing at all). Same class of
	// collapse, this is the second instance of it.
	body, err := json.Marshal(donePayload{StopReason: normalizedStop(finishReason)})
	if err != nil {
		log.Error("proxy marshal done", logErrKey, err)
		return
	}
	writeSSEFrame(log, w, flusher, "done", body)
}

// emitError —— a mid-stream SSE error frame (used internally by callers).
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

// writeProxyErr —— a pre-stream failure (cred resolve / model build / msg parsing): HTTP
// status + one SSE error frame to the browser, so it goes through the catch path.
func writeProxyErr(log *slog.Logger, w http.ResponseWriter, err error) {
	cls := ClassifyStreamErr(err)
	log.Error("proxy pre-stream", logErrKey, err, "code", cls.Code)
	setStreamSSEHeaders(w)
	w.WriteHeader(cls.Status)
	emitError(log, w, pickFlusher(w), err)
}
