// Package i18n — a note's multilingual structure: parsing, validation, and per-language
// retrieval.
//
// The contract is the nested callout itself; the frontmatter is entirely optional:
//
//	> [!i18n]
//	> > [!lang] en
//	> > # Title
//	> > ...
//	>
//	> > [!lang] zh
//	> > # 标题
//	> > ...
//
// Three things are enforced by the structure, not by a lint:
//
//   - **One note is one note**, not N documents. Prose outside the `[!i18n]` block is
//     **language-neutral** and must appear under every language; splitting into N
//     documents would duplicate that prose N times, and search would return N hits too.
//   - **Each pane declares its own language code.** When frontmatter's langs disagrees
//     with the panes, **trust the panes** — they are closest to the content. A mismatch
//     gets reported, but content is never rewritten.
//   - **Infer what's missing, never rewrite what's already written.** With no langs,
//     infer it from the panes; when langs is present but disagrees, report it. If not
//     even one pane matches the wanted language → fall back the whole note to lang (the
//     identity language) rather than guessing one and pasting it in.
//
// N has no upper bound: the "2..3" in the vault's own lint was never a design choice —
// it's three hand-written nth-of-type rules in CSS.
package i18n

import "regexp"

// Severity — how serious a diagnostic is. Error gets the MCP write rejected;
// Warning only reports (the sync still goes through).
type Severity string

const (
	// SeverityError — this note's multilingual structure is broken; rendering must
	// fall back to a single language.
	SeverityError Severity = "error"
	// SeverityWarning — it renders fine, but there's something worth reporting
	// (translation quality / a declaration disagreeing with the content).
	SeverityWarning Severity = "warning"
)

// Diagnostic — one diagnostic. Code routes it for machines, Message is for
// people and agents to read.
type Diagnostic struct {
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	Severity Severity `json:"severity"`
}

// Frontmatter — the fields validation looks at, all of them optional.
type Frontmatter struct {
	LangLabels map[string]string
	Lang       string
	Langs      []string
}

var (
	// reCalloutMarker — a callout's first line: `[!type] optional title`.
	reCalloutMarker = regexp.MustCompile(`^\[!([\w-]+)\][+-]?[ \t]*(.*)$`)
	// reFence — a fenced code block (``` or ~~~). A `[!i18n]` inside a tikz block is not
	// a region — that lesson cost the vault's own lint dearly, and we copy it as-is.
	reFence = regexp.MustCompile("^\\s*(```|~~~)")
)
