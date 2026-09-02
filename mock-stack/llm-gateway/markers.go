// markers.go —— e2e embeds delay markers in the visitor's question text, giving
// "transient in-turn UI" (throbber / thinking rotation) a time window that a DOM
// assertion can catch.
//
//	[[think:N]]       —— this turn skips all tools, sleeps N ms, then emits the
//	                     final answer. No tool runs during that window → the
//	                     frontend shows the thinking-word-list rotation.
//	[[slow-final:N]]  —— normal tool flow (search→read), but sleeps N ms before
//	                     emitting the final answer. corpus_read's throbber
//	                     ("reading X") stays up during that window.
//
// A marker in the visitor's question → request-scoped, controls only this
// turn's timing, never crosses specs. The marker is stripped from the search
// query (makeSearchCall uses stripMarkers) but is still shown normally by the
// frontend in the question text (tests don't care).
//
// script keyword —— isolation for scripts (next_tool/next_reply/…) relies on
// the test embedding a unique keyword `[[s:testId-yyy]]` in the message (see
// the e2e mock-llm-script fixture); the mock matches registered keywords by
// Contains (script.go). This file's only job here is stripping `[[s:…]]` out
// of the search query so the keyword doesn't pollute corpus_search matches.
// Matching uses the raw text, no extraction.
package main

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

var delayMarkerRe = regexp.MustCompile(`\[\[(think|slow-final):(\d+)\]\]`)

// scriptKeyRe —— the `[[s:KEY]]` wrapper a test embeds to carry its script
// keyword. Stripped from the corpus_search query so the keyword never leaks into
// the search (matching itself uses the raw request text, in script.go).
var scriptKeyRe = regexp.MustCompile(`\[\[s:[^\]]+\]\]`)

// scriptKeyTokens —— all `[[s:…]]` wrappers in a stream turn's text, joined.
// The mock RETAINS these from each visitor turn so backend-initiated generate
// calls (GhostPolicy, summarize) — which are built from derived content and
// don't carry the visitor message — can still be matched to this turn's
// registrations (script.go, via lastKeys). Returns "" if none.
func scriptKeyTokens(text string) string {
	return strings.Join(scriptKeyRe.FindAllString(text, -1), " ")
}

func markerDelay(text, kind string) time.Duration {
	for _, m := range delayMarkerRe.FindAllStringSubmatch(text, -1) {
		if m[1] == kind {
			ms, _ := strconv.Atoi(m[2])
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 0
}

func stripMarkers(text string) string {
	text = delayMarkerRe.ReplaceAllString(text, "")
	text = scriptKeyRe.ReplaceAllString(text, "")
	return strings.TrimSpace(text)
}
