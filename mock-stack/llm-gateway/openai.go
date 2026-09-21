// openai.go —— openai-compat endpoint (`/v1/chat/completions` + `/v1/models`) for dev/e2e.
//
// The whole openai-compat provider family (deepseek / kimi / groq / together / openrouter /
// siliconflow / custom self-host) shares ONE wire and ONE eino adapter, so this is ONE
// endpoint, not one per vendor. It reuses the same scripting state as the Anthropic path
// (s.queue takeToolFor / takeReplyFor / fail / rate-limit, s.rec recorder), translating the
// SAME dispatch decision into openai wire: assistant `tool_calls` + `finish_reason:"tool_calls"`
// for a tool step, plain text + `finish_reason:"stop"` for the final answer.
//
// **Strict deserialization, like the real openai/DeepSeek APIs.** Messages are decoded
// preserving key-presence; if any message lacks the `content` key, the request is rejected with
// HTTP 422 and the exact body the real DeepSeek deserializer returns. That is the fidelity that
// reproduces the prod bug: go-openai serializes an assistant message with tool_calls + empty
// content WITHOUT the `content` field (`json:"content,omitempty"`); OpenAI tolerates it,
// DeepSeek 422s — so every eiab tool-calling visitor turn failed on the openai-compat path,
// invisibly to an Anthropic-only mock.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// oaiChatReq —— only the fields the mock needs. Messages stay as raw maps so the strict
// content-presence check can see which keys the client actually sent.
type oaiChatReq struct {
	Model    string                       `json:"model"`
	Stream   bool                         `json:"stream"`
	Messages []map[string]json.RawMessage `json:"messages"`
}

func (s *server) serveChatCompletions(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		oaiError(s.log, w, http.StatusBadRequest, "read body", "invalid_request_error")
		return
	}
	var req oaiChatReq
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		oaiError(s.log, w, http.StatusBadRequest, "bad json", "invalid_request_error")
		return
	}
	// STRICT content-presence: the real DeepSeek deserializer requires every message to carry
	// a `content` field. This is the one check that reproduces the prod 422 — do it first, the
	// way a real provider bounces the request before any turn accounting.
	if i, missing := firstMessageMissingContent(req.Messages); missing {
		oaiError(s.log, w, http.StatusUnprocessableEntity,
			fmt.Sprintf("Failed to deserialize the JSON body: messages[%d]: missing field `content`", i),
			"invalid_request_error")
		return
	}
	marker := oaiMarkerText(req.Messages)
	s.rec.record(RequestRecord{
		Path: r.URL.Path, Model: req.Model, AuthPrefix: authPrefix(r), Stream: req.Stream,
	}, marker)
	if s.queue.shouldFailFor(marker) {
		oaiError(s.log, w, http.StatusInternalServerError, "mock injected failure", "server_error")
		return
	}
	if secs := s.queue.rateLimitFor(marker); secs > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		oaiError(s.log, w, http.StatusTooManyRequests, "mock injected rate limit", "rate_limit_error")
		return
	}
	if !req.Stream {
		s.serveOpenAINonStream(w, &req, marker)
		return
	}
	s.serveOpenAIStream(w, &req, marker)
}

// firstMessageMissingContent —— the index of the first message with no `content` key, and
// whether one exists. Matches go-openai's `content,omitempty` on an assistant tool-call
// message with empty content.
func firstMessageMissingContent(msgs []map[string]json.RawMessage) (int, bool) {
	for i := range msgs {
		if _, ok := msgs[i]["content"]; !ok {
			return i, true
		}
	}
	return 0, false
}

func (s *server) serveOpenAIStream(w http.ResponseWriter, req *oaiChatReq, marker string) {
	sse, serr := newSSE(w)
	if serr != nil {
		http.Error(w, serr.Error(), http.StatusInternalServerError)
		return
	}
	s.queue.rememberTurnKeys(scriptKeyTokens(marker))
	if t := s.queue.takeToolFor(marker); t != nil {
		s.emitOpenAIToolCalls(sse, req.Model, scriptedCallsOf(t))
		return
	}
	text, finish := s.reply, "stop"
	if scripted, stop, ok := s.queue.takeReplyFor(marker); ok {
		text = scripted
		if stop == stopMaxTokens {
			finish = "length"
		}
	}
	s.emitOpenAIText(sse, req.Model, text, finish)
}

// serveOpenAINonStream —— the generate-shaped calls (GhostPolicy / followup / summarize) also
// go through this endpoint when the owner's provider is openai-compat. Reuses the same
// detectors as the Anthropic path so behavior matches. No `[system:]` echo here: a real
// openai/DeepSeek does not echo the system prompt into its reply (that echo is an
// Anthropic-path affordance for prompt-assembly specs).
func (s *server) serveOpenAINonStream(w http.ResponseWriter, req *oaiChatReq, marker string) {
	matchText := marker + " " + s.queue.retainedKeys()
	sys := oaiSystemText(req.Messages)
	if isGhostPolicy(sys) {
		s.writeOpenAIMessage(w, req.Model, s.queue.takeGhostFor(matchText), "stop")
		return
	}
	if isFollowupGen(sys) {
		s.writeOpenAIMessage(w, req.Model, followupGhosts, "stop")
		return
	}
	text, finish := s.reply, "stop"
	if scripted, stop, ok := s.queue.takeReplyFor(matchText); ok {
		text = scripted
		if stop == stopMaxTokens {
			finish = "length"
		}
	}
	s.writeOpenAIMessage(w, req.Model, text, finish)
}

// oaiMarkerText —— the concatenated text of every message, for the keyword scan (the
// `[[s:key]]` tag lives in the visitor's user message).
func oaiMarkerText(msgs []map[string]json.RawMessage) string {
	var b strings.Builder
	for i := range msgs {
		b.WriteString(oaiExtractText(msgs[i]["content"]))
		b.WriteString(" ")
	}
	return b.String()
}

// oaiSystemText —— the text of the first system-role message (used by the generate-call
// detectors).
func oaiSystemText(msgs []map[string]json.RawMessage) string {
	for i := range msgs {
		var role string
		_ = json.Unmarshal(msgs[i]["role"], &role)
		if role == "system" {
			return oaiExtractText(msgs[i]["content"])
		}
	}
	return ""
}

// oaiExtractText —— openai `content` is either a string, or an array of parts
// (`[{"type":"text","text":"…"}]`), or null/absent. Returns the concatenated text.
func oaiExtractText(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	if raw[0] == '[' {
		var parts []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &parts) == nil {
			var b strings.Builder
			for i := range parts {
				if parts[i].Type == "text" {
					b.WriteString(parts[i].Text)
				}
			}
			return b.String()
		}
	}
	return ""
}

// --- openai wire emit ---

type oaiToolCallWire struct {
	Index    int             `json:"index"`
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Function oaiFunctionWire `json:"function"`
}

type oaiFunctionWire struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type oaiDelta struct {
	Role      string            `json:"role,omitempty"`
	Content   string            `json:"content,omitempty"`
	ToolCalls []oaiToolCallWire `json:"tool_calls,omitempty"`
}

type oaiStreamChoice struct {
	Index        int      `json:"index"`
	Delta        oaiDelta `json:"delta"`
	FinishReason *string  `json:"finish_reason"`
}

type oaiStreamChunk struct {
	ID      string            `json:"id"`
	Object  string            `json:"object"`
	Model   string            `json:"model"`
	Choices []oaiStreamChoice `json:"choices"`
}

func newChunk(model string, choice oaiStreamChoice) oaiStreamChunk {
	return oaiStreamChunk{
		ID: "chatcmpl-mock", Object: "chat.completion.chunk", Model: model,
		Choices: []oaiStreamChoice{choice},
	}
}

func (s *server) emitOpenAIText(sse *sseWriter, model, text, finish string) {
	if err := sse.sendData(newChunk(model, oaiStreamChoice{
		Delta: oaiDelta{Role: "assistant", Content: text},
	})); err != nil {
		s.log.Warn("emit openai text delta", "err", err)
		return
	}
	s.emitOpenAIFinish(sse, model, finish)
}

// emitOpenAIToolCalls —— dispatch every scripted call as one assistant message with a
// `tool_calls` array, then close with `finish_reason:"tool_calls"`. Supports the multi-call
// (parallel) shape, same as the Anthropic path's emitToolUseTurnN.
func (s *server) emitOpenAIToolCalls(sse *sseWriter, model string, calls []ScriptedToolCall) {
	wire := make([]oaiToolCallWire, 0, len(calls))
	for i := range calls {
		args := string(calls[i].Args)
		if args == "" {
			args = "{}"
		}
		wire = append(wire, oaiToolCallWire{
			Index: i, ID: fmt.Sprintf("call_mock_%d_%s", i, calls[i].Name), Type: "function",
			Function: oaiFunctionWire{Name: calls[i].Name, Arguments: args},
		})
	}
	if err := sse.sendData(newChunk(model, oaiStreamChoice{
		Delta: oaiDelta{Role: "assistant", ToolCalls: wire},
	})); err != nil {
		s.log.Warn("emit openai tool_calls delta", "err", err)
		return
	}
	s.emitOpenAIFinish(sse, model, "tool_calls")
}

func (s *server) emitOpenAIFinish(sse *sseWriter, model, finish string) {
	fr := finish
	if err := sse.sendData(newChunk(model, oaiStreamChoice{FinishReason: &fr})); err != nil {
		s.log.Warn("emit openai finish", "err", err)
		return
	}
	if err := sse.sendDone(); err != nil {
		s.log.Warn("emit openai [DONE]", "err", err)
	}
}

type oaiRespMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type oaiRespChoice struct {
	Index        int            `json:"index"`
	Message      oaiRespMessage `json:"message"`
	FinishReason string         `json:"finish_reason"`
}

func (s *server) writeOpenAIMessage(w http.ResponseWriter, model, text, finish string) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{
		"id":      "chatcmpl-mock",
		"object":  "chat.completion",
		"model":   model,
		"choices": []oaiRespChoice{{Message: oaiRespMessage{Role: "assistant", Content: text}, FinishReason: finish}},
		"usage":   map[string]int{"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
	}); err != nil {
		s.log.Warn("encode openai message", "err", err)
	}
}

// oaiError —— the openai/DeepSeek error envelope: `{"error":{"message":…,"type":…}}`. go-openai
// unmarshals this into APIError and surfaces `status code: <n>, …, message: <msg>`.
func oaiError(log interface{ Warn(string, ...any) }, w http.ResponseWriter, status int, message, typ string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"message": message, "type": typ},
	}); err != nil {
		log.Warn("write openai error", "err", err)
	}
}
