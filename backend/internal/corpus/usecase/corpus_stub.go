// corpus_stub.go —— pure extractors for corpus_peek's node "signature": the heading outline,
// the [[outlinks]] (dedup, in order), and the lead prose line. All operate on the markdown
// body; frontmatter and code fences are handled so a stub reflects the note's shape, not its
// raw markup (the same rendered-not-markup discipline the raw excerpts should follow).

package usecase

import (
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

var (
	headingLineRe = regexp.MustCompile(`(?m)^(#{1,6})\s+(.+?)\s*$`)
	frontmatterRe = regexp.MustCompile(`(?s)\A\s*---\r?\n.*?\r?\n---\r?\n`)
	fenceLineRe   = regexp.MustCompile("^```")
	// wikilinkTargetRe matches [[t]] / [[t|alias]] and captures the target t.
	wikilinkTargetRe = regexp.MustCompile(`\[\[([^\]|]+)(?:\|[^\]]*)?\]\]`)
	inlineEmphasisRe = regexp.MustCompile(`[*_` + "`" + `>]+`)
)

// extractHeadings —— the note's `#`-heading outline, prefixed by depth ("## X" → "## X"),
// bounded. This is the note's table of contents — the cheapest read of "what's in here".
func extractHeadings(body string, limit int) []string {
	out := make([]string, 0, limit)
	for _, m := range headingLineRe.FindAllStringSubmatch(body, -1) {
		out = append(out, m[1]+" "+strings.TrimSpace(m[2]))
		if len(out) >= limit {
			break
		}
	}
	return out
}

// extractOutlinkTargets —— [[wikilink]] targets in order, deduped, bounded. Aliases stripped
// (target only), so the agent sees which nodes this one points at — the graph edges to crawl.
func extractOutlinkTargets(body string, limit int) []string {
	out := make([]string, 0, limit)
	seen := map[string]bool{}
	for _, ref := range ExtractCrossLinks(body) {
		t := strings.TrimSpace(ref.Target)
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
		if len(out) >= limit {
			break
		}
	}
	return out
}

type leadFence struct{ code, math bool }

// LeadLine —— the first line of real prose: after frontmatter, skipping headings, code fences,
// list markers, and wikilink-only lines. Lightly de-marked and truncated on a rune boundary.
// Empty if the note is all structure.
//
// **Pick one language plane first, then find the sentence** (F-L-47). This vault's
// prose lives almost entirely inside `> > ` (the i18n contract's language plane),
// but `isProseLine` treats any line starting with `>` as structure — so across the
// real corpus's 1047 notes, LeadLine returned empty for the vast majority: the admin
// entry table had no summary line, and the homepage pin card was left with just a
// slug.
//
// F-L-45 hit the same thing on the **retrieval** path, and wrote a separate
// line-by-line blockquote stripper there, with the reasoning captured in a comment —
// but this shared function was never updated to match
// ([[lesson-not-swept-to-neighbours]]).
//
// This function does **not** strip blockquotes line-by-line: that would also strip
// annotation lines like `> Parent: [[engineering]]` down to prose. The distinction
// between the language plane and an annotation is **structural**, and the `i18n`
// parser is the thing that understands that structure — so render the body down to a
// single language first (the parser strips the two layers of quoting per the
// contract; quoting *inside* a pane is left as quoting), then apply the original
// prose-detection rule. `# Heading` still doesn't count: the page header already
// prints the title (same rationale as UX-85).
func LeadLine(body string, limit int) string {
	body = frontmatterRe.ReplaceAllString(body, "")
	if doc := i18n.Parse(body); doc.Multilingual() {
		body = i18n.Render(&doc, "", "")
	}
	var f leadFence
	for raw := range strings.SplitSeq(body, "\n") {
		line := strings.TrimSpace(raw)
		var skip bool
		skip, f = leadSkip(line, f)
		if skip {
			continue
		}
		return textcut.BytesMark(cleanLead(line), limit)
	}
	return ""
}

// leadSkip —— advance the code-fence / display-math-fence state for a line and report whether to
// skip it (inside a fence, a fence delimiter, or a structure line). `$$` on its own line is a
// display-math delimiter, so the whole block is skipped — not just the delimiter.
func leadSkip(line string, f leadFence) (bool, leadFence) {
	if fenceLineRe.MatchString(line) {
		return true, leadFence{code: !f.code, math: f.math}
	}
	if line == "$$" {
		return true, leadFence{code: f.code, math: !f.math}
	}
	return f.code || f.math || !isProseLine(line), f
}

// nonProsePrefixes —— lines starting with these are structure, not the lead prose line.
// `$$` catches display-math blocks (`$$ \begin{aligned}…`); a single `$` (currency) is left
// alone so "it cost $80M" survives — see the [[render]] currency-escape work.
var nonProsePrefixes = []string{"#", ">", "- ", "* ", "| ", "$$"}

func isProseLine(line string) bool {
	if line == "" {
		return false
	}
	for _, p := range nonProsePrefixes {
		if strings.HasPrefix(line, p) {
			return false
		}
	}
	// a line that is ONLY a wikilink / image / frontmatter fence isn't prose.
	stripped := strings.TrimSpace(wikilinkTargetRe.ReplaceAllString(line, ""))
	return stripped != "" && stripped != "---"
}

func cleanLead(line string) string {
	line = wikilinkTargetRe.ReplaceAllString(line, "$1") // [[X|a]] → X
	line = inlineEmphasisRe.ReplaceAllString(line, "")
	return strings.TrimSpace(line)
}
