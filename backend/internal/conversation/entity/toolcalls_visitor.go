// toolcalls_visitor.go -- of a round's tool_calls, which parts are safe to show the
// **visitor**.
//
// F-A-28: the visitor's own conversation response echoed the persisted tool_calls
// verbatim, including the full corpus_read result -- the body text of private
// subjectivity notes, and its own `"show_as_source":false` flag. The citations field
// in that same response was empty: the citation gate did its job, but this channel
// bypassed it entirely. The live-stream round had the same bug.
//
// Why strip the entire result instead of filtering by show_as_source:
//   • The visitor side **never needs** the raw retrieval result at all -- the UI
//     collapses corpus_* calls into two numbers, "searched N · read M", and never
//     renders any body text (tool-call-shape.ts). Sending it serves no purpose and
//     carries only risk.
//   • A channel that carries body text but tries to mask the private ones is one
//     forgotten branch away from the next instance of this same bug. A channel that
//     carries no body text at all doesn't have this problem.
//
// Non-retrieval tools (booker's report card, summarize's html, skill_*/ext_*) keep
// their result as-is -- those are already meant to be rendered for the visitor.

package entity

import "encoding/json"

// corpusToolPrefix -- the name prefix for the retrieval family of tools. corpus is a
// kernel-owned concept (not an externalized capability), so this layer is allowed to
// know about it; knowing about specific capabilities like booker / mail would be overreach.
const corpusToolPrefix = "corpus_"

// VisitorToolCalls -- the persisted tool_calls JSON, mapped to the subset that's safe
// to send to the visitor.
//
// If parsing fails, return an empty array: better the visitor misses one collapsed-count
// block than we leak something we failed to understand, unparsed and whole.
func VisitorToolCalls(raw []byte) []byte {
	if len(raw) == 0 {
		return []byte("[]")
	}
	var calls []map[string]json.RawMessage
	if json.Unmarshal(raw, &calls) != nil {
		return []byte("[]")
	}
	for i := range calls {
		stripCorpusResult(calls[i])
	}
	out, err := json.Marshal(calls)
	if err != nil {
		return []byte("[]")
	}
	return out
}

// VisitorToolResult -- the live-stream path: whether one tool call's result can be sent
// to the visitor as-is. Retrieval-family calls return an empty string (the UI only
// counts them); everything else passes through as-is -- those results are meant to be
// rendered.
func VisitorToolResult(name, result string) string {
	if isCorpusToolName(name) {
		return ""
	}
	return result
}

func isCorpusToolName(name string) bool {
	return len(name) >= len(corpusToolPrefix) && name[:len(corpusToolPrefix)] == corpusToolPrefix
}

// stripCorpusResult -- for a retrieval call, drops the result but keeps name and ok
// (the UI only uses those two to count).
func stripCorpusResult(call map[string]json.RawMessage) {
	if !isCorpusCall(call) {
		return
	}
	delete(call, "result")
}

func isCorpusCall(call map[string]json.RawMessage) bool {
	raw, ok := call["name"]
	if !ok {
		return false
	}
	var name string
	if json.Unmarshal(raw, &name) != nil {
		return false
	}
	return isCorpusToolName(name)
}
