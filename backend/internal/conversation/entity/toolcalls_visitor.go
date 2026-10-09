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
// kernel-owned concept (not an externalized block), so this layer is allowed to
// know about it; knowing about specific blocks like booker / mail would be overreach.
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

// VisitorToolResult -- the live-stream path: what of one tool call's result may reach the
// visitor. Retrieval-family calls send nothing, with one exception: a corpus_read of a citable
// note keeps exactly its citation (genre, id, path, slug, title, body) — the footer and its
// expand-on-click read that, and a citable note is one the visitor may be shown. A read the AI
// may not cite (show_as_source=false, subjectivity) sends nothing. Everything else passes
// through as-is -- those results are meant to be rendered.
func VisitorToolResult(name, result string) string {
	if !isCorpusToolName(name) {
		return result
	}
	if name != "corpus_read" {
		return ""
	}
	return citationOf(result)
}

// readCitation -- the citation fields of a corpus_read result; nothing else of it.
type readCitation struct {
	ShowAsSource *bool  `json:"show_as_source,omitempty"`
	Genre        string `json:"genre"`
	ID           string `json:"id"`
	Path         string `json:"path"`
	Slug         string `json:"slug"`
	Title        string `json:"title"`
	Body         string `json:"body"`
}

// citationOf -- a citable read's citation as JSON, "" for anything else (unparseable included:
// better a missing footnote than a leak of something not understood).
func citationOf(result string) string {
	var c readCitation
	if json.Unmarshal([]byte(result), &c) != nil || !citable(&c) {
		return ""
	}
	c.ShowAsSource = nil
	out, err := json.Marshal(c)
	if err != nil {
		return ""
	}
	return string(out)
}

// citable -- the footer's rule (sdk corpus-read-wire.ts citableCorpusRead): wiki / output /
// writing / post, minus wiki / output marked not-a-source. Subjectivity is never cited. A post
// read here was already admitted by its audience, so it is cited (time + excerpt, no link).
func citable(c *readCitation) bool {
	switch c.Genre {
	case "writing", "post":
		return true
	case "wiki", "output":
		return c.ShowAsSource == nil || *c.ShowAsSource
	default:
		return false
	}
}

func isCorpusToolName(name string) bool {
	return len(name) >= len(corpusToolPrefix) && name[:len(corpusToolPrefix)] == corpusToolPrefix
}

// stripCorpusResult -- for a retrieval call, the same rule as the live stream (VisitorToolResult):
// a citable corpus_read keeps exactly its citation, every other retrieval result is dropped (name
// and ok stay — the UI counts with them). So a replay shows what the visitor was shown live, a
// post's citation included, and nothing more (docs/design/posts.md, "What a visitor was shown
// stays in their own record").
func stripCorpusResult(call map[string]json.RawMessage) {
	name := callName(call)
	if !isCorpusToolName(name) {
		return
	}
	// The persisted result is the tool's JSON as it came back; the citation is the same kind.
	if shown := VisitorToolResult(name, string(call["result"])); shown != "" {
		call["result"] = json.RawMessage(shown)
		return
	}
	delete(call, "result")
}

func callName(call map[string]json.RawMessage) string {
	var name string
	if json.Unmarshal(call["name"], &name) != nil {
		return ""
	}
	return name
}
