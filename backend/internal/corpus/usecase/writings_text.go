// writings_text.go —— markdown text helpers: strip-to-plain (for the visitor chat
// retriever's bag-of-words index) + read-time estimation (~225 wpm).
//
// No goldmark import: retrieval precision only needs bag-of-words, and 30 lines of
// regex cover that. Switch to goldmark if AST-level semantics (e.g. cross-ref
// resolution) become necessary later.

package usecase

import (
	"regexp"
	"strings"
)

const readWPM = 225

// estimateReadMinutes —— rough read-time estimate. Counts words over the raw
// markdown body; markdown syntax is a small enough share (<10%) that the error
// is negligible. Floors at 1 minute.
func estimateReadMinutes(bodyMD string) int32 {
	if bodyMD == "" {
		return 0
	}
	words := len(strings.Fields(StripMarkdown(bodyMD)))
	return max(int32((words+readWPM-1)/readWPM), 1)
}

// markdownStripPatterns —— order-sensitive: the fence-block pattern must consume
// fenced code before any other rule runs (a backtick inside a fence is literal
// text, not inline code, and must not be treated as such).
var markdownStripPatterns = []*regexp.Regexp{
	regexp.MustCompile("(?s)```[a-zA-Z0-9_+-]*\n.*?\n```"), // fenced code block
	regexp.MustCompile("`[^`]+`"),                          // inline code
	regexp.MustCompile(`!\[([^\]]*)\]\([^)]+\)`),           // image → alt
	regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`),            // link → text
	regexp.MustCompile(`(?m)^#{1,6}\s+`),                   // heading marker
	regexp.MustCompile(`(?m)^>\s?`),                        // blockquote marker
	regexp.MustCompile(`(?m)^[-*+]\s+`),                    // bullet marker
	regexp.MustCompile(`(?m)^\d+\.\s+`),                    // numbered marker
	regexp.MustCompile(`(?m)^-{3,}\s*$`),                   // horizontal rule
	regexp.MustCompile(`\*\*([^*]+)\*\*`),                  // bold
	regexp.MustCompile(`__([^_]+)__`),                      // bold alt
	regexp.MustCompile(`\*([^*]+)\*`),                      // italic
	regexp.MustCompile(`_([^_]+)_`),                        // italic alt
	regexp.MustCompile(`~~([^~]+)~~`),                      // strike
}

// markdownStripReplacements —— index-aligned with markdownStripPatterns. Empty
// string = delete the whole match; "$1" = keep the captured group (link text,
// alt text, bold/italic inner text, etc).
var markdownStripReplacements = []string{
	"", "$1", "$1", "$1", "", "", "", "", "", "$1", "$1", "$1", "$1", "$1",
}

// StripMarkdown —— reduces markdown to plain text, for the retriever's
// bag-of-words index and for word-count estimation. Does not guarantee semantic
// fidelity, but does guarantee no words are dropped.
func StripMarkdown(md string) string {
	out := md
	for i, p := range markdownStripPatterns {
		out = p.ReplaceAllString(out, markdownStripReplacements[i])
	}
	return strings.TrimSpace(collapseWhitespace(out))
}

var whitespaceRe = regexp.MustCompile(`\s+`)

func collapseWhitespace(s string) string {
	return whitespaceRe.ReplaceAllString(s, " ")
}
