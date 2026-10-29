// terms_internal_test.go —— the cue-card Terms (glossary) mechanism (cue 术语表 spec, 2026-10-28).
// Pure, PII-free, deterministic: extraction is mechanical (library terms that appear in the card
// body, in first-appearance order, plus closure), never the model's pick. Definitions come from the
// curated library, so there is nothing to fabricate (§2.4 is a curation discipline, enforced by
// TestLibraryDefsIntroduceNoUnexplainedTerm).

package cues

import (
	"strings"
	"testing"
)

// termWords —— the Term strings of a card's glossary, in order.
func termWords(entries []TermEntry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Term)
	}
	return out
}

func hasTerm(entries []TermEntry, term string) bool {
	for _, e := range entries {
		if e.Term == term {
			return true
		}
	}
	return false
}

// TestTermsExtractsEveryMentioned —— §4.1: a card that mentions PII, ASR and WER has all three
// entries; the model can't quietly skip the hard one because the server extracts them.
func TestTermsExtractsEveryMentioned(t *testing.T) {
	t.Parallel()
	card := "**Key: scrub PII first**\n- Strip PII before anything is logged.\n" +
		"- The ASR transcript has errors, so track WER.\n\n_From: software/project/x/notes_"
	got := cardTerms(card)
	for _, want := range []string{"PII", "ASR", "WER"} {
		if !hasTerm(got, want) {
			t.Fatalf("term %q missing; got %v", want, termWords(got))
		}
	}
}

// TestTermsNoneWhenNoTerms —— §4.2: a card with no glossary term produces no entries (so the app
// renders no Terms block).
func TestTermsNoneWhenNoTerms(t *testing.T) {
	t.Parallel()
	card := "**Key: be concrete**\n- Give one specific example from your own work.\n" +
		"- Name the trade-off you weighed.\n\n_From: software/project/x/notes_"
	if got := cardTerms(card); len(got) != 0 {
		t.Fatalf("expected no terms, got %v", termWords(got))
	}
}

// TestTermsFirstAppearanceOrderAndDedup —— §2.2: entries follow first-appearance order and each
// term appears once, however many times the body mentions it.
func TestTermsFirstAppearanceOrderAndDedup(t *testing.T) {
	t.Parallel()
	card := "**Key: WER then PII**\n- WER drives the eval; PII must be scrubbed.\n" +
		"- Watch WER again and the ASR drift."
	want := []string{"WER", "PII", "ASR"}
	if got := termWords(cardTerms(card)); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("order/dedup: got %v want %v", got, want)
	}
}

// TestTermsClosurePullsReferenced —— §2.3: when a term's definition leans on another library term,
// that term joins the glossary too, even if the body never named it. "shadow traffic"'s definition
// mentions canary, so a card that only says "shadow traffic" lists canary as well.
func TestTermsClosurePullsReferenced(t *testing.T) {
	t.Parallel()
	card := "**Key: shadow traffic**\n- Run the new model on shadow traffic before any cutover."
	got := cardTerms(card)
	if !hasTerm(got, "shadow traffic") {
		t.Fatalf("shadow traffic missing; got %v", termWords(got))
	}
	if !hasTerm(got, "canary") {
		t.Fatalf("closure failed: canary not pulled in by shadow traffic's definition; got %v",
			termWords(got))
	}
}

// TestTermsMultiWord —— a multi-word term ("golden set") is matched as a phrase, not split.
func TestTermsMultiWord(t *testing.T) {
	t.Parallel()
	card := "**Key: golden set**\n- Score every change against the golden set."
	if got := cardTerms(card); !hasTerm(got, "golden set") {
		t.Fatalf("golden set missing; got %v", termWords(got))
	}
}

// TestTermsIgnoreCitation —— §2.1: the Terms come from the body, not the From citation. A term that
// appears only inside the _From:_ path must not produce an entry.
func TestTermsIgnoreCitation(t *testing.T) {
	t.Parallel()
	card := "**Key: be concrete**\n- Give an example.\n\n_From: software/project/canary/notes_"
	if got := cardTerms(card); len(got) != 0 {
		t.Fatalf("a term only in the citation must not count; got %v", termWords(got))
	}
}

// TestTermsPure —— §4.4: extraction never mutates the card text (Terms is a separate, additive
// field; the body / Key / From / mode / downgrade are untouched).
func TestTermsPure(t *testing.T) {
	t.Parallel()
	card := "**Key: scrub PII**\n- Strip PII first.\n\n_From: x_"
	before := card
	_ = cardTerms(card)
	if card != before {
		t.Fatal("cardTerms mutated its input")
	}
}

// TestTermsEntriesHaveDefinitions —— every produced entry carries a non-empty one-line definition
// (library-sourced, so never fabricated), and the definition is a single line.
func TestTermsEntriesHaveDefinitions(t *testing.T) {
	t.Parallel()
	for _, e := range cardTerms("**Key: PII, ASR, WER, canary, shadow traffic, golden set**") {
		if strings.TrimSpace(e.Def) == "" {
			t.Fatalf("term %q has no definition", e.Term)
		}
		if strings.Contains(e.Def, "\n") {
			t.Fatalf("term %q definition is not one line: %q", e.Term, e.Def)
		}
	}
}

// TestLibraryDefsIntroduceNoUnexplainedTerm —— §2.3 / §4.3 closure invariant: no definition may
// introduce a new unexplained term. Mechanically: any ALL-CAPS acronym token (≥2 letters) that
// appears in a definition must itself be a library Term. This is what lets closure terminate and
// guarantees a reader never meets a word the glossary leaves undefined.
func TestLibraryDefsIntroduceNoUnexplainedTerm(t *testing.T) {
	t.Parallel()
	known := map[string]bool{}
	for _, e := range termLibrary {
		known[e.Term] = true
	}
	for _, e := range termLibrary {
		for _, tok := range acronymsIn(e.Def) {
			if !known[tok] {
				t.Fatalf("definition of %q introduces unexplained acronym %q", e.Term, tok)
			}
		}
	}
}

// TestLibraryNoEmptyDef —— §2.4 curation floor: the library never ships a term with no definition
// (an uncertain term is left out of the library, not shipped with a fabricated one).
func TestLibraryNoEmptyDef(t *testing.T) {
	t.Parallel()
	for _, e := range termLibrary {
		if strings.TrimSpace(e.Def) == "" || strings.TrimSpace(e.Term) == "" {
			t.Fatalf("library entry has empty term or def: %+v", e)
		}
	}
}
