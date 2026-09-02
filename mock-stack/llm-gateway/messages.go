// messages.go —— POST /v1/messages handler.
//
// Decision tree (ported from backend's old mock_single_turn.go):
//
//  1. scripted tool queued by e2e?         → emit tool_use, stop=tool_use
//  2. corpus_search offered + no result?   → emit corpus_search tool_use
//  3. corpus_search ran + corpus_read
//     offered + no read result?            → emit corpus_read tool_use
//  4. skill_*/ext_* tool offered + no
//     result?                              → emit one of them
//  5. else                                  → emit final text reply,
//     stop=end_turn
//
// The final text reply prepends "[system:...]\n" + per-message
// "[skill_result:...]\n" echoes so e2e specs verifying system prompt
// assembly + skill/ext tool invocation still see those markers.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// toolCorpusRead —— serveStream's [[slow-final:N]] marker only takes effect once corpus_read
// already has a result (the call that produces the final answer); used to recognize that.
const toolCorpusRead = "corpus_read"

func (s *server) serveMessages(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var req MessagesReq
	if uerr := json.Unmarshal(body, &req); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	// An invalid tool name → the whole array is rejected together, same as a real provider.
	// Placed before the accounting: a real provider bounces the request back at this step,
	// leaving no trace that "this turn actually ran."
	if rejectBadToolName(w, &req) {
		return
	}
	// Record first, then dispatch —— an injected failure needs recording too: "which provider
	// this turn hit" and "whether this turn succeeded" are two separate things (when testing
	// how a provider outage falls back to a default, what's asserted is exactly where that
	// failed request went).
	s.rec.record(recordFrom(r, &req), req.markerText())
	// e2e fail-injection: once next_error is turned on for a keyword, any inference call whose
	// message contains that keyword returns 500, simulating an LLM fault (tests that "a failed/
	// retried turn doesn't consume quota").
	if s.queue.shouldFailFor(req.markerText()) {
		http.Error(w, `{"error":"mock injected failure"}`, http.StatusInternalServerError)
		return
	}
	// e2e rate-limit injection: once next_rate_limit is registered, a call whose message
	// contains that keyword returns **429 + Retry-After**. This is the exact thing
	// agent-loop-robustness's Real dep names — "can inject a rate-limit response and a retry
	// hint" —— that I'd always treated as an external device, when it's just these few lines.
	if secs := s.queue.rateLimitFor(req.markerText()); secs > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		http.Error(w, `{"error":"mock injected rate limit"}`, http.StatusTooManyRequests)
		return
	}
	if !req.Stream {
		s.serveNonStream(w, &req)
		return
	}
	s.serveStream(w, &req)
}

func (s *server) serveStream(w http.ResponseWriter, req *MessagesReq) {
	sse, serr := newSSE(w)
	if serr != nil {
		http.Error(w, serr.Error(), http.StatusInternalServerError)
		return
	}
	// [[slow-final:N]] —— corpus_read has already run → this is the call that produces the
	// final answer. The sleep sits **before** message_start: the moment this call starts
	// emitting frames, the frontend replaces the read throbber with the answer stream; by
	// holding for N ms before any frame goes out, the read throbber ("reading X") stays put
	// in the DOM long enough to assert on (test #9).
	if d := markerDelay(req.markerText(), "slow-final"); d > 0 && req.hasToolResult(toolCorpusRead) {
		time.Sleep(d)
	}
	if werr := emitMessageStart(sse, req.Model); werr != nil {
		s.log.Warn("emit message_start", "err", werr)
		return
	}
	s.dispatch(sse, req)
}

// followupGhosts —— the follow-up generation call at turn wrap-up (non-streaming, system is
// followupGenPrompt) always returns these 3 fixed entries, so the e2e's SSE `ghosts` frame
// has content, letting a test verify "after the answer finishes, the input's ghost advances
// to the followup." Kept distinct from the seed questions, to make asserting easier.
const followupGhosts = `["What got you into this work?",` +
	`"How do you handle on-call?","What are you building next?"]`

// isFollowupGen —— whether this non-stream call is a follow-up generation (recognized by the
// phrase "JSON array of 3 strings," unique to followupGenPrompt).
func isFollowupGen(req *MessagesReq) bool {
	return strings.Contains(req.System.Text, "JSON array of 3 strings")
}

// isGhostPolicy —— whether this non-stream call is GhostPolicy (a single steering-ghost
// generation, recognized by "ONE GHOST MESSAGE," unique to its prompt). Returns via
// takeGhost(): either a scripted body or the default null (silence).
func isGhostPolicy(req *MessagesReq) bool {
	return strings.Contains(req.System.Text, "ONE GHOST MESSAGE")
}

// serveNonStream —— /v1/messages stream=false. Anthropic returns one
// JSON envelope: {content: [block...], stop_reason: ...}. Visitor
// summary / follow-up / ghost-policy generation all go through this path (no tools, no agent loop).
func (s *server) serveNonStream(w http.ResponseWriter, req *MessagesReq) {
	// Backend-initiated generate calls (GhostPolicy / summarize) are built from
	// derived content and don't carry the visitor message's keyword, so also match
	// against the retained keywords of the turn that triggered this call.
	matchText := req.markerText() + " " + s.queue.retainedKeys()
	if isGhostPolicy(req) {
		s.writeNonStream(w, req.Model, s.queue.takeGhostFor(matchText))
		return
	}
	if isFollowupGen(req) {
		s.writeNonStream(w, req.Model, followupGhosts)
		return
	}
	text := s.reply
	// The non-stream path only uses the body text; stop is a streaming wrap-up concern (see
	// emitFinalReply).
	if scripted, _, ok := s.queue.takeReplyFor(matchText); ok {
		text = scripted
	}
	// summarize report generation returns the report HTML RAW (like a real LLM) — no [system:...]
	// echo. The echo (composeFinalReply) is for chat replies where tests assert prompt assembly;
	// prepending it to a report pollutes the stored HTML (and breaks HTML sanitization on it).
	if !isSummarizeGen(req) {
		text = composeFinalReply(req, text)
	}
	s.writeNonStream(w, req.Model, text)
}

// isSummarizeGen —— the non-stream call that generates a conversation report (its system is the
// summarize component-kit prompt). Detected by a phrase unique to summarizeHTMLPrompt.
func isSummarizeGen(req *MessagesReq) bool {
	return strings.Contains(req.System.Text, "report component kit")
}

func (s *server) writeNonStream(w http.ResponseWriter, model, text string) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(nonStreamMessage{
		ID:      "msg_mock_1",
		Type:    "message",
		Role:    "assistant",
		Model:   model,
		Content: []map[string]string{{"type": "text", "text": text}},
		Stop:    stopEndTurn,
		Usage:   map[string]int{"input_tokens": 1, "output_tokens": 1},
	}); err != nil {
		s.log.Warn("encode non-stream message", "err", err)
	}
}

type nonStreamMessage struct {
	ID      string              `json:"id"`
	Type    string              `json:"type"`
	Role    string              `json:"role"`
	Model   string              `json:"model"`
	Content []map[string]string `json:"content"`
	Stop    string              `json:"stop_reason"`
	Usage   map[string]int      `json:"usage"`
}

// dispatch —— pure registration lookup: emits only tools that **the test registered**
// (takeToolFor matches on a keyword in the message), otherwise emits the final reply. The
// mock no longer "guesses" on the LLM's behalf what to search or which tool to call —— to
// make the agent call corpus_search / corpus_read / skill_ / ext_, the test registers it
// itself (scriptMockToolCall). The think marker is only intra-turn timing, not a guess.
func (s *server) dispatch(sse *sseWriter, req *MessagesReq) {
	msgText := req.markerText()
	// Retain this visitor turn's keywords so its follow-up backend generate calls
	// (GhostPolicy / summarize), which don't carry the visitor message, still match
	// this turn's registrations.
	s.queue.rememberTurnKeys(scriptKeyTokens(msgText))
	if t := s.queue.takeToolFor(msgText); t != nil {
		s.emitToolUseTurnN(sse, scriptedCallsOf(t))
		return
	}
	// [[think:N]] —— skips the tool, sleeps, then emits the answer directly. With no tool
	// running during that time, the frontend shows the rotating thinking-vocabulary line
	// (test #10).
	if d := markerDelay(msgText, "think"); d > 0 {
		time.Sleep(d)
		s.emitFinalReply(sse, req)
		return
	}
	s.emitFinalReply(sse, req)
}

// scriptedCallsOf —— flattens one registration into the call sequence to dispatch this turn:
// the main call first, then Also in order.
func scriptedCallsOf(t *ScriptedTool) []ScriptedToolCall {
	out := make([]ScriptedToolCall, 0, 1+len(t.Also))
	out = append(out, ScriptedToolCall{Name: t.Name, Args: t.Args})
	return append(out, t.Also...)
}

// emitToolUseTurnN —— dispatches N tool_use blocks in one message, then closes with
// `stop=tool_use`. N=1 is the old behavior.
//
// **ids are keyed by index, not by name.** The old code did `toolu_mock_<name>`, so a tool
// appearing twice with the same name in one turn would collide onto the same id —— and
// "the same name multiple times" is exactly this capability's most important use case
// (F-S-1). A collision raises no error, it just makes two calls look like one downstream ——
// a bug that silently flattens the exact shape under test.
func (s *server) emitToolUseTurnN(sse *sseWriter, calls []ScriptedToolCall) {
	for i := range calls {
		input := calls[i].Args
		if len(input) == 0 {
			input = json.RawMessage(`{}`)
		}
		id := fmt.Sprintf("toolu_mock_%d_%s", i, calls[i].Name)
		if err := emitToolUseBlock(sse, i, id, calls[i].Name, input); err != nil {
			s.log.Warn("emit tool_use", "err", err, "index", i)
			return
		}
	}
	if err := emitMessageDelta(sse, stopToolUse); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

func (s *server) emitFinalReply(sse *sseWriter, req *MessagesReq) {
	text, stop := s.reply, stopEndTurn
	if scripted, scriptedStop, ok := s.queue.takeReplyFor(req.markerText()); ok {
		text, stop = scripted, scriptedStop
	}
	// **An empty body + max_tokens is something a real vendor actually does**: when the
	// budget is spent entirely on tool calls, Anthropic closes the stream without emitting
	// even one text block (measured in prod: `stop=max_tokens answer_chars=0`, the visitor
	// got not a single character after 51 retrievals —— F-A-40).
	// This used to go through composeFinalReply unconditionally, so **this mock was politer
	// than the real vendor**: even when a script's text was an empty string, it would still
	// echo back a whole `[system:…]` block, so that boundary could never be tested
	// ([[stand-in-is-politer-than-reality]]). The rule is now narrowed to exactly the one
	// case "the script explicitly asks for an empty body + budget exhausted"; every other
	// call still gets the echo.
	if text == "" && stop == stopMaxTokens {
		s.emitEmptyBudgetStop(sse)
		return
	}
	text = composeFinalReply(req, text)
	if err := emitTextBlock(sse, 0, text); err != nil {
		s.log.Warn("emit text", "err", err)
		return
	}
	if err := emitMessageDelta(sse, stop); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

// emitEmptyBudgetStop —— closes the stream, but emits no text block at all. See the comment
// in emitFinalReply: this is the shape a real vendor's wrap-up takes when the budget went
// entirely to tool calls.
func (s *server) emitEmptyBudgetStop(sse *sseWriter) {
	if err := emitMessageDelta(sse, stopMaxTokens); err != nil {
		s.log.Warn("emit message_delta", "err", err)
		return
	}
	if err := emitMessageStop(sse); err != nil {
		s.log.Warn("emit message_stop", "err", err)
	}
}

// echoToolPrefixes —— the **registry** of tool-name prefixes whose "tool result should be
// echoed into the mock reply ([skill_result:...])". To support something new (another
// sandboxed plugin, a normalized built-in capability), **register a prefix** here.
//
// Why echo these at all: the e2e assertions for sandbox / FS / network "confinement" need to
// tell "actually read vs. rejected" apart, and the mock reply is otherwise hardcoded; only by
// reflecting the real tool result back into the reply does the assertion stop being vacuous.
var echoToolPrefixes = []string{
	"skill_", "ext_", // Phase C skills + third-party ext-mcp
	"everything_", "fsmcp_", "netfetch_", "cagedfetch_", "escapee_", // e2e's real third-party sandboxed plugins
}

// shouldEchoResult —— whether this tool result should be echoed into the mock reply
// ([skill_result:...]). Uses the broad echoToolPrefixes registry (sandboxed-plugin prefixes
// included) so sandbox/FS/network confinement assertions can tell a real read apart from a
// rejection.
func shouldEchoResult(name string) bool {
	for _, p := range echoToolPrefixes {
		if strings.HasPrefix(name, p) {
			return true
		}
	}
	return false
}

// composeFinalReply —— echo system prompt + every skill_result body the
// assistant has seen, then append the base reply text. Matches what the
// old MockProvider emitted so e2e assertions on "[system:...]" /
// "[skill_result:...]" markers still pass.
//
// Markers are separated from the base reply by a blank line so markdown
// in `base` (headings, fenced code, tables) parses standalone — a single
// `\n` would glue the next line into the previous para and break things
// like `# Heading` (commonmark needs the heading at block start).
func composeFinalReply(req *MessagesReq, base string) string {
	var b strings.Builder
	if req.System.Text != "" {
		b.WriteString("[system:")
		b.WriteString(req.System.Text)
		b.WriteString("]\n\n")
	}
	collectSkillEchoes(req, &b)
	b.WriteString(base)
	return b.String()
}

// collectSkillEchoes —— walk Anthropic-shape messages, for every
// tool_result block whose paired tool_use is skill_*/ext_*, echo
// "[skill_result:<body>]\n\n". Matches the original mock_single_turn
// behavior so e2e assertions on system prompt assembly + skill/ext
// tool execution still surface.
func collectSkillEchoes(req *MessagesReq, out *strings.Builder) {
	skillIDs := skillExtToolUseIDs(req.Messages)
	for i := range req.Messages {
		m := &req.Messages[i]
		if m.Role != "user" {
			continue
		}
		for j := range m.Content {
			echoSkillResultBlock(&m.Content[j], skillIDs, out)
		}
	}
}

func skillExtToolUseIDs(msgs []Msg) map[string]bool {
	out := map[string]bool{}
	for i := range msgs {
		if msgs[i].Role != "assistant" {
			continue
		}
		for j := range msgs[i].Content {
			b := &msgs[i].Content[j]
			if b.Type == "tool_use" && shouldEchoResult(b.Name) && b.ID != "" {
				out[b.ID] = true
			}
		}
	}
	return out
}

func echoSkillResultBlock(b *Block, ids map[string]bool, out *strings.Builder) {
	if b.Type != "tool_result" || !ids[b.ToolUseID] {
		return
	}
	body := unwrapResultJSONRaw(b.Content)
	out.WriteString("[skill_result:")
	out.WriteString(body)
	out.WriteString("]\n\n")
}

// unwrapResultJSONRaw —— extracts tool_result.content across its possible wire shapes: it
// may be a JSON-encoded string, or it may be the anthropic-sdk-go content-block array form.
// Handled uniformly via wire.go's unwrapToolResultContent.
func unwrapResultJSONRaw(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	return unwrapResultJSON(string(unwrapToolResultContent(raw)))
}

// unwrapResultJSON —— if body is {"ok":true,"result":<x>}, return <x>;
// else return body as-is.
func unwrapResultJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	var wrap struct {
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal([]byte(raw), &wrap); err == nil && len(wrap.Result) > 0 {
		return string(wrap.Result)
	}
	return raw
}
