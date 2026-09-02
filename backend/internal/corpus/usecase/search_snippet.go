// search_snippet.go — cleans the database's **hit fragment** into a sentence a human can read
// directly.
//
// Why this can't reuse `LeadLine`: that function answers "what is this note's first line of
// prose", scanning line by line for the **first prose line**, and `isProseLine` skips any line
// starting with `>` as structure. This vault's body text is **almost entirely** wrapped in a
// two-level `> > ` blockquote (the language face of an i18n callout), so LeadLine returns empty
// for these notes — that is exactly the deep mechanism behind F-L-45: search results carry no
// one-line summary at all, and the owner is left with a bare list of slugs.
//
// A fragment and a "beginning" are two different things: a fragment is cut from the middle of
// the body text, and its first line is usually a half-cut marker. So the approach here is to
// **strip the wrapping first, then join**: strip the blockquote prefix → strip the callout
// marker → strip HTML tags → strip inline emphasis/wikilink targets, then join what's left with
// spaces. If it's still empty after cleaning, return empty (an empty summary beats showing the
// owner `> [!i18n] > <label><input type="radio"…`).

package usecase

import (
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

var (
	// quotePrefixRe — the blockquote layer at line start (`> `, `> > `, `>>`). A callout's
	// body text lives inside it.
	quotePrefixRe = regexp.MustCompile(`^(?:\s*>+\s?)+`)
	// calloutMarkerRe — Obsidian's callout marker (`[!i18n]` / `[!lang] en`).
	calloutMarkerRe = regexp.MustCompile(`\[![a-zA-Z0-9_-]+\]\s*[a-zA-Z-]*`)
	// orphanCalloutRe — a fragment is cut from the **middle** of the body text, so the left
	// half of `[!i18n]` can fall outside the window, leaving just `i18n]` dangling at the
	// start. This is exactly what was seen on real corpus data for finding 5
	// (`i18n] EN 中文 …`).
	orphanCalloutRe = regexp.MustCompile(`^[a-zA-Z0-9_-]*\]\s*`)
	// markupLineRe — this line contains an HTML tag (the i18n toggler's `<label><input …>`).
	// **Drop the whole line, not just the tags**: since a fragment is cut from the middle, the
	// tags are often half-open, and stripping just the tags would leave a stray `EN 中文` on
	// screen — that's the toggler's button label, not this note's content (also what was seen
	// on real corpus data for finding 5). A line carrying a toggler is not prose.
	markupLineRe = regexp.MustCompile(`</?(?:label|input|div|span|br)\b`)
	// frontmatterLineRe — a fragment from the raw tier is often cut out of frontmatter
	// (`tags: - node - flexmesh ---`). Key-value lines, list items, and `---` fences are never
	// body text.
	frontmatterLineRe = regexp.MustCompile(`^(?:---\s*$|[a-zA-Z_][\w-]*:\s*$|-\s+\S+\s*$)`)
	// headingHashRe — the leading `#` on a line; once stripped, the heading line itself can
	// serve as a summary.
	headingHashRe = regexp.MustCompile(`^#{1,6}\s*`)
)

// snippetLinesGuess — how many lines a cleaned fragment usually leaves (the `MaxFragments=1`
// window is short). Just an initial capacity hint.
const snippetLinesGuess = 4

// SearchSnippet — hit fragment → one human sentence (truncated to limit bytes, on a character
// boundary).
func SearchSnippet(fragment string, limit int) string {
	parts := make([]string, 0, snippetLinesGuess)
	for raw := range strings.SplitSeq(fragment, "\n") {
		line := unwrapSnippetLine(raw)
		if line == "" {
			continue
		}
		parts = append(parts, line)
	}
	return textcut.BytesMark(strings.Join(parts, " "), limit)
}

// unwrapSnippetLine — one line: strip the wrapping and markers, return the readable part
// (empty string if nothing readable remains).
//
// This path **strips blockquotes line by line**, which `LeadLine` does not do (F-L-47): a
// fragment is cut from the middle of the body text, so there's no structure left to work with
// and lines must be inspected one at a time; a complete note, in contrast, has structure — it's
// rendered to a single language via the i18n contract first, so a pane's side note
// (`> Parent: …`) can still be recognized as a side note over there.
func unwrapSnippetLine(raw string) string {
	line := quotePrefixRe.ReplaceAllString(strings.TrimSpace(raw), "")
	if markupLineRe.MatchString(line) || frontmatterLineRe.MatchString(line) {
		return ""
	}
	line = calloutMarkerRe.ReplaceAllString(line, "")
	line = orphanCalloutRe.ReplaceAllString(line, "")
	line = headingHashRe.ReplaceAllString(line, "")
	return cleanLead(line)
}
