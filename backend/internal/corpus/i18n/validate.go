// validate.go —— structural diagnostics for one note's multilingual layout.
//
// One rule governs the balance: **infer what's missing, report what disagrees, never
// rewrite what's written**. So a missing `langs` is inferred from the panes (not
// reported); `langs` disagreeing with the panes is reported (but rendering still
// follows the panes); and "attach this content to a different language label" is never
// done — the whole note falls back to monolingual instead.
//
// The error/warning line is also one rule: **does rendering still hold together**.
// Structural breakage (an empty pane, a declared fallback with no pane) is an error;
// translation-quality issues (one face much shorter, mismatched link counts) are
// warnings — worth surfacing to the owner, but not worth blocking a write.

package i18n

import (
	"fmt"
	"strings"
)

// Diagnostic codes, for machine routing; the human-readable line lives in Message.
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

// diagHint —— initial capacity of the diagnostics slice (a note usually carries one or two).
const diagHint = 4

// shortPaneRatio —— a pane shorter than this ratio of the longest pane gets flagged
// (usually a sign of a missed translation).
const shortPaneRatio = 0.35

// Validate —— all diagnostics (error + warning) for this note. Empty = no issues.
//
// A monolingual note (no `[!i18n]` at all) returns empty: that's the path the vast
// majority of notes take, and validation should stay silent on it.
func Validate(fm *Frontmatter, body string) []Diagnostic {
	doc := Parse(body)
	out := make([]Diagnostic, 0, diagHint)
	out = append(out, declaredVsPanes(fm, &doc)...)
	out = append(out, paneShape(&doc)...)
	out = append(out, orphanPanes(&doc, body)...)
	return out
}

// HasError —— whether any diagnostic reaches the "rendering doesn't hold" tier. MCP
// writes are rejected on this.
func HasError(ds []Diagnostic) bool {
	for i := range ds {
		if ds[i].Severity == SeverityError {
			return true
		}
	}
	return false
}

// declaredVsPanes —— whether what frontmatter declares matches what the body actually has.
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

// langsMismatch —— a language is declared but the body has no pane for it. Trust the
// panes, but report it.
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

// fallbackLangMissing —— lang is where every fallback lands; if it has no pane of its
// own, there's nowhere left to fall back to.
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

// paneShape —— problems intrinsic to a pane itself: no code, empty, duplicate, or
// noticeably short.
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

// paneCodeShape —— problems with the language code itself: missing (can't render ->
// error), or duplicate (the first pane wins -> warning).
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

// orphanPanes —— a `[!lang]` sitting outside any `[!i18n]`. It renders as a plain
// callout (no crash), but the owner most likely meant it as a language pane — flag it
// so it doesn't silently turn into a decorative box.
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

// countLangMarkers —— total `[!lang]` lines anywhere in the body (any quote depth,
// excluding fences). Compared against the count found inside blocks, the difference
// is what's sitting outside.
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

// missingFrom —— entries present in declared but absent from found.
func missingFrom(declared, found []string) []string {
	out := []string{}
	for _, d := range declared {
		if !contains(found, strings.ToLower(strings.TrimSpace(d))) {
			out = append(out, d)
		}
	}
	return out
}
