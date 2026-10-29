// terms.go —— the cue-card Terms (glossary) mechanism (cue 术语表 spec, 2026-10-28).
//
// A card often names jargon the reader must look up mid-answer (PII, ASR, WER, canary, shadow
// traffic …). This adds an optional, additive glossary: the terms the card's BODY mentions, each
// with a one-line plain-language definition, so the reader has something to glance at without
// leaving the card. It never touches the card's own fields (Text / Key / From / mode / downgrade).
//
// Extraction is MECHANICAL, not the model's pick (§2.2): the term universe is the curated library
// below, and a card's glossary is exactly the library terms that appear in its body, in first-
// appearance order, plus any term a shown definition leans on (closure, §2.3). The model never
// decides what to explain, so it can't quietly skip the hard word. Definitions are library-sourced,
// so there is nothing to fabricate — §2.4 ("宁缺勿编") is a curation discipline: a term we cannot
// define with confidence is left out of the library, never shipped with a guessed definition.
//
// The library lives in terms.tsv (one "term<TAB>definition" line each), embedded at build time.
// Keeping the non-Latin definition text in a data file, not Go string literals, is what lets the
// server source stay Latin-only (gosmopolitan) and lets the library grow by editing data, not code.
// The definition language is the reader's working language (here Chinese); the Term itself stays
// verbatim as the card wrote it (English). The From citation is not scanned (§2.1).

package cues

import (
	_ "embed"
	"regexp"
	"strings"
)

// TermEntry —— one glossary row: the term as the card wrote it, and a one-line definition.
type TermEntry struct {
	Term string
	Def  string
}

//go:embed terms.tsv
var termsTSV string

// termLibrary —— the term universe, loaded from terms.tsv. Definitions are one line, in the
// reader's language, and lean only on plain words or on another library Term (closure, enforced by
// the test). Grow it by editing terms.tsv; never add an entry whose definition is uncertain (§2.4).
var termLibrary = parseTermLib(termsTSV)

func parseTermLib(s string) []TermEntry {
	lines := strings.Split(s, "\n")
	out := make([]TermEntry, 0, len(lines))
	for _, line := range lines {
		term, def, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if ok && strings.TrimSpace(term) != "" {
			out = append(out, TermEntry{Term: strings.TrimSpace(term), Def: strings.TrimSpace(def)})
		}
	}
	return out
}

// acronymRE —— an ALL-CAPS token of ≥2 letters; the shape of an unexplained acronym a definition
// might smuggle in. The closure-invariant test uses it to prove every such token in a definition is
// itself a library term.
var acronymRE = regexp.MustCompile(`\b[A-Z]{2,}\b`)

func acronymsIn(s string) []string {
	return acronymRE.FindAllString(s, -1)
}

// termRE —— compiled, case-insensitive, word-bounded matchers, index-aligned with termLibrary.
// `\b` sits at the ASCII boundary, so an English term embedded in CJK text still matches.
var termRE = buildTermRE(termLibrary)

func buildTermRE(lib []TermEntry) []*regexp.Regexp {
	out := make([]*regexp.Regexp, len(lib))
	for i, e := range lib {
		out[i] = regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(e.Term) + `\b`)
	}
	return out
}

// cardTerms —— the glossary for a finished card: the library terms its body mentions, in first-
// appearance order, closed over the definitions (a definition that leans on another library term
// pulls that term in). The From / USED machine lines are stripped first, so the citation does not
// contribute terms (§2.1). Pure: it never mutates the card.
func cardTerms(card string) []TermEntry {
	return closeOverDefs(bodyTermsInOrder(stripControl(card)))
}

// bodyTermsInOrder —— the library terms present in the body, ordered by where they first appear.
func bodyTermsInOrder(body string) []TermEntry {
	pos := make([]int, 0, len(termLibrary))
	picked := make([]TermEntry, 0, len(termLibrary))
	for i, re := range termRE {
		if loc := re.FindStringIndex(body); loc != nil {
			pos = append(pos, loc[0])
			picked = append(picked, termLibrary[i])
		}
	}
	sortByAppearance(pos, picked)
	return picked
}

// sortByAppearance —— stable insertion sort of picked by its parallel pos slice (the list is tiny).
func sortByAppearance(pos []int, picked []TermEntry) {
	for i := 1; i < len(pos); i++ {
		for j := i; j > 0 && pos[j] < pos[j-1]; j-- {
			pos[j], pos[j-1] = pos[j-1], pos[j]
			picked[j], picked[j-1] = picked[j-1], picked[j]
		}
	}
}

// closeOverDefs —— adds every library term a shown definition leans on (§2.3). Body terms keep
// their first-appearance order; terms a definition pulls in are appended in discovery order. Loops
// to a fixpoint (a pulled-in term's own definition may lean on a further term).
func closeOverDefs(picked []TermEntry) []TermEntry {
	in := make(map[string]bool, len(picked))
	for _, e := range picked {
		in[e.Term] = true
	}
	for i := 0; i < len(picked); i++ {
		picked = append(picked, newTermsInDef(picked[i].Def, in)...)
	}
	return picked
}

// newTermsInDef —— library terms a definition leans on that `in` does not hold yet; each is marked
// in `in` as it is found, so the caller's fixpoint loop terminates.
func newTermsInDef(def string, in map[string]bool) []TermEntry {
	add := make([]TermEntry, 0)
	for i, re := range termRE {
		if e := termLibrary[i]; !in[e.Term] && re.MatchString(def) {
			in[e.Term] = true
			add = append(add, e)
		}
	}
	return add
}
