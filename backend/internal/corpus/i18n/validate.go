// validate.go —— 一条笔记的多语结构诊断。
//
// 分寸只有一句:**推断缺的,报告不一致的,绝不改写写着的**。
// 所以 langs 缺了就从 pane 推(不报),langs 跟 pane 对不上就报(但按 pane 渲染),
// 而"把一段内容贴到另一个语言标签下"这种事一次都不做 —— 宁可整条退回单语。
//
// error 与 warning 的分界也只有一句:**渲染还成不成立**。结构坏了(pane 是空的、
// 声明的落点不存在)是 error;翻译质量类(某一面短得多、链接数量不一致)是 warning ——
// 它们值得让 owner 看见,但不该拦住一次写入。

package i18n

import (
	"fmt"
	"strings"
)

// 诊断码。给机器分流用;人读的那句在 Message 里。
const (
	CodeLangsWithoutBlock = "langs_without_block"
	CodeLangsMismatch     = "langs_mismatch"
	CodeDuplicatePane     = "duplicate_pane"
	CodeEmptyPane         = "empty_pane"
	CodePaneWithoutCode   = "pane_without_code"
	CodeOrphanLangPane    = "orphan_lang_pane"
	CodeLangNotInLangs    = "lang_not_in_langs"
	CodeShortPane         = "short_pane"
)

// diagHint —— 诊断切片的初始容量(一条笔记通常一两条)。
const diagHint = 4

// shortPaneRatio —— 一面比最长的那面短到这个比例以下 → 提醒一句(多半是漏译了)。
const shortPaneRatio = 0.35

// Validate —— 这条笔记的全部诊断(error + warning)。空 = 没问题。
//
// 单语笔记(一个 `[!i18n]` 都没有)返回空:绝大多数笔记走的就是这条路,校验不该在那儿说话。
func Validate(fm *Frontmatter, body string) []Diagnostic {
	doc := Parse(body)
	out := make([]Diagnostic, 0, diagHint)
	out = append(out, declaredVsPanes(fm, &doc)...)
	out = append(out, paneShape(&doc)...)
	out = append(out, orphanPanes(&doc, body)...)
	return out
}

// HasError —— 有没有到"渲染不成立"那一档。MCP 写入据此拒绝。
func HasError(ds []Diagnostic) bool {
	for i := range ds {
		if ds[i].Severity == SeverityError {
			return true
		}
	}
	return false
}

// declaredVsPanes —— frontmatter 说的和正文里真有的对不对得上。
func declaredVsPanes(fm *Frontmatter, doc *Doc) []Diagnostic {
	if fm == nil {
		return []Diagnostic{}
	}
	if len(fm.Langs) > 0 && !doc.Multilingual() {
		return []Diagnostic{{
			Code: CodeLangsWithoutBlock, Severity: SeverityError,
			Message: fmt.Sprintf(
				"frontmatter declares langs %v but the body has no `> [!i18n]` block, "+
					"so there is nothing to switch between", fm.Langs),
		}}
	}
	out := make([]Diagnostic, 0, diagHint)
	out = append(out, langsMismatch(fm, doc)...)
	return append(out, fallbackLangMissing(fm, doc)...)
}

// langsMismatch —— 声明了、但正文里没有那一面。信 pane,报一句。
func langsMismatch(fm *Frontmatter, doc *Doc) []Diagnostic {
	missing := missingFrom(fm.Langs, doc.Langs)
	if len(missing) == 0 {
		return []Diagnostic{}
	}
	return []Diagnostic{{
		Code: CodeLangsMismatch, Severity: SeverityError,
		Message: fmt.Sprintf(
			"frontmatter declares langs %v but only %v have panes (%v missing); "+
				"the note renders in a single language until they agree",
			fm.Langs, doc.Langs, missing),
	}}
}

// fallbackLangMissing —— lang 是所有退路的落点;它自己没有面的话,退无可退。
func fallbackLangMissing(fm *Frontmatter, doc *Doc) []Diagnostic {
	if fm.Lang == "" || !doc.Multilingual() || contains(doc.Langs, fm.Lang) {
		return []Diagnostic{}
	}
	return []Diagnostic{{
		Code: CodeLangNotInLangs, Severity: SeverityError,
		Message: fmt.Sprintf(
			"lang: %s has no pane — it is the language everything falls back to, "+
				"so it must be one of %v", fm.Lang, doc.Langs),
	}}
}

// paneShape —— pane 自己的毛病:没写码、空的、重复的、明显短一截的。
func paneShape(doc *Doc) []Diagnostic {
	out := make([]Diagnostic, 0, diagHint)
	for r := range doc.Regions {
		out = append(out, regionPaneShape(&doc.Regions[r])...)
	}
	return out
}

func regionPaneShape(region *Region) []Diagnostic {
	out := make([]Diagnostic, 0, diagHint)
	seen := map[string]bool{}
	longest := longestPane(region.Panes)
	for i := range region.Panes {
		out = append(out, onePaneShape(&region.Panes[i], seen, longest)...)
	}
	return out
}

func onePaneShape(p *Pane, seen map[string]bool, longest int) []Diagnostic {
	out := paneCodeShape(p, seen)
	if strings.TrimSpace(p.Body) == "" {
		return append(out, Diagnostic{
			Code: CodeEmptyPane, Severity: SeverityError,
			Message: fmt.Sprintf(
				"the %q pane is empty — a reader who picks it gets nothing", p.Lang),
		})
	}
	if longest > 0 && float64(len([]rune(p.Body)))/float64(longest) < shortPaneRatio {
		return append(out, Diagnostic{
			Code: CodeShortPane, Severity: SeverityWarning,
			Message: fmt.Sprintf(
				"the %q pane is much shorter than the others — is part untranslated?",
				p.Lang),
		})
	}
	return out
}

// paneCodeShape —— 语言码本身的毛病:没写(渲染不出来 → error),或者重复(用第一面 → warning)。
func paneCodeShape(p *Pane, seen map[string]bool) []Diagnostic {
	switch {
	case p.Lang == "":
		return []Diagnostic{{
			Code: CodePaneWithoutCode, Severity: SeverityError,
			Message: "a `> [!lang]` pane has no language code — write `> [!lang] en`",
		}}
	case seen[p.Lang]:
		return []Diagnostic{{
			Code: CodeDuplicatePane, Severity: SeverityWarning,
			Message: fmt.Sprintf("two panes claim %q; the first one is used", p.Lang),
		}}
	default:
		seen[p.Lang] = true
		return []Diagnostic{}
	}
}

func longestPane(panes []Pane) int {
	longest := 0
	for i := range panes {
		if n := len([]rune(panes[i].Body)); n > longest {
			longest = n
		}
	}
	return longest
}

// orphanPanes —— `[!lang]` 长在 `[!i18n]` 外面。它会当成一个普通 callout 渲染出来(不崩),
// 但 owner 多半是想写一个语言面 —— 报一句,让它别静悄悄地变成一个装饰框。
func orphanPanes(doc *Doc, body string) []Diagnostic {
	inRegions := 0
	for r := range doc.Regions {
		inRegions += len(doc.Regions[r].Panes)
	}
	if total := countLangMarkers(body); total > inRegions {
		return []Diagnostic{{
			Code: CodeOrphanLangPane, Severity: SeverityWarning,
			Message: fmt.Sprintf(
				"%d `[!lang]` pane(s) sit outside any `> [!i18n]` block and render as a plain "+
					"callout, not as a language", total-inRegions),
		}}
	}
	return []Diagnostic{}
}

// countLangMarkers —— 正文里一共有几行 `[!lang]`(任何引用深度,围栏里的不算)。
// 跟区块内数出来的那些一比,差额就是长在外面的。
func countLangMarkers(body string) int {
	n := 0
	lines := strings.Split(normalizeNewlines(body), "\n")
	for i := 0; i < len(lines); i++ {
		if skip, ok := fenceSpan(lines, i); ok {
			i = skip
			continue
		}
		bare := strings.TrimLeft(lines[i], " \t>")
		if m := reCalloutMarker.FindStringSubmatch(strings.TrimSpace(bare)); len(m) > 1 &&
			strings.EqualFold(m[1], "lang") {
			n++
		}
	}
	return n
}

// missingFrom —— declared 里有、found 里没有的那些。
func missingFrom(declared, found []string) []string {
	out := []string{}
	for _, d := range declared {
		if !contains(found, strings.ToLower(strings.TrimSpace(d))) {
			out = append(out, d)
		}
	}
	return out
}
