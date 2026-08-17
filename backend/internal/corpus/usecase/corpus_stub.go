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
// **先选一面语言，再找那句话**（F-L-47）。这个 vault 的散文几乎全都住在 `> > ` 里面
// （i18n 契约的语言面），而 `isProseLine` 把任何 `>` 开头的行当结构 —— 于是真语料的 1047 条
// 笔记里 LeadLine 对绝大多数返回空：后台条目表没有一行摘要，首页那张 pin 卡只剩一个 slug。
//
// F-L-45 在**检索**那条路上撞过同一件事，当时另写了一个按行拆引用的清理器，原因写进了注释 ——
// 但共用的这一个没跟着改（[[lesson-not-swept-to-neighbours]]）。
//
// 这里**不按行拆引用**：那样会把 `> Parent: [[engineering]]` 这种旁注也拆成散文。
// 语言面和旁注的区别是**结构**，而认识这个结构的是 `i18n` 那个解析器 —— 所以先把正文渲成
// 单语（pane 的两层引用由它按契约剥掉，pane 里面的引用照旧是引用），再用原来的规矩找散文。
// `# 标题` 依旧不算：页头已经印过标题了（同 UX-85 的判据）。
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
