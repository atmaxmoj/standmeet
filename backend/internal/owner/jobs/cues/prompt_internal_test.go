// prompt_internal_test.go —— pure, PII-free checks on the cue system prompt's structure and the
// server-side From stamping.

package cues

import (
	"strings"
	"testing"
)

// TestDisciplineAlwaysPresent —— the answer-as-asked / gap / no-bridge / process-facts /
// generic-vs-personal discipline closes every prompt (cue-defect-loop, cue-gap-discipline, H2,
// cue-generic-fabrication-fix).
func TestDisciplineAlwaysPresent(t *testing.T) {
	t.Parallel()
	p := systemPrompt("ctx", "rules")
	if !strings.Contains(p, "ANSWER THE QUESTION ACTUALLY ASKED") {
		t.Fatal("discipline block missing")
	}
	if !strings.Contains(p, "Generic vs personal") {
		t.Fatal("generic-vs-personal discipline missing")
	}
}

// TestSamplePromptHasNoFrameLeak —— cue-generic-fabrication-fix F-1: the prompt must not prime the
// stages-and-gates / testing-methodology frame through any example (the few-shot sample card, a Key
// example, a bare-label example, or the discipline text). The §0 accident copied that frame from
// the prompt, so the words that carry it may not appear anywhere in the assembled prompt.
func TestSamplePromptHasNoFrameLeak(t *testing.T) {
	t.Parallel()
	low := strings.ToLower(systemPrompt("ctx", "rules"))
	for _, leak := range []string{
		"stages-and-gates", "stages & gates", "stages, gates", "gates + regression",
		"golden set", "utter-manual", "testing-method", "testing-software",
	} {
		if strings.Contains(low, leak) {
			t.Fatalf("prompt still primes the frame: %q present", leak)
		}
	}
}

// TestPromptHasStampingInstructions —— F-2/F-3: the prompt tells the model to emit the USED line
// and the generic marker, and shows it no From line to write.
func TestPromptHasStampingInstructions(t *testing.T) {
	t.Parallel()
	p := systemPrompt("ctx", "rules")
	if !strings.Contains(p, "General — not from your notes") {
		t.Fatal("generic-mode marker instruction missing")
	}
	if !strings.Contains(p, "USED:") {
		t.Fatal("USED citation instruction missing")
	}
	if strings.Contains(p, "_From:") {
		t.Fatal("the prompt still shows the model a From line to write")
	}
}

// TestFinalizeDropsForged —— F-2: the From line is the server's, built from the real sources; a
// forged node and any model-written From line are dropped.
func TestFinalizeDropsForged(t *testing.T) {
	t.Parallel()
	sources := []string{"software/engineering/model-to-production", "cv"}
	in := "**Key: x**\nbody line\n_From: forged-node, another-forgery_\n" +
		"USED: software/engineering/model-to-production, ghost/node, cv"
	got := finalize(in, &cueCtx{sources: sources})
	for _, forged := range []string{"forged-node", "another-forgery", "ghost/node", "USED:"} {
		if strings.Contains(got.card, forged) {
			t.Fatalf("control/forged content survived (%q): %q", forged, got.card)
		}
	}
	if !strings.Contains(got.card, "_From: software/engineering/model-to-production, cv_") {
		t.Fatalf("real sources not stamped: %q", got.card)
	}
	// A path the model copied with the surrounding "(…)" from the context header is still matched.
	parenIn := "body\nUSED: (cv), (software/engineering/model-to-production)"
	paren := finalize(parenIn, &cueCtx{sources: sources})
	if !strings.Contains(paren.card, "_From: cv, software/engineering/model-to-production_") {
		t.Fatalf("parenthesised USED paths were not matched: %q", paren.card)
	}
}

// suffixSources —— two deep paths that share the "deployment" tail, plus a unique one.
var suffixSources = []string{
	"software/project/standmeet/architecture/deployment",
	"software/project/standmeet/design-principles",
	"software/project/youteacher/deployment", // shares the "deployment" tail
}

func onePath(t *testing.T, got []string, want string) {
	t.Helper()
	if len(got) != 1 || got[0] != want {
		t.Fatalf("want [%s], got %v", want, got)
	}
}

// TestUsedPathsSuffixMatch —— R1: a short USED name resolves to the full source path by a unique
// segment-aligned suffix; an exact full path wins even when its tail is shared.
func TestUsedPathsSuffixMatch(t *testing.T) {
	t.Parallel()
	onePath(t, usedPaths("USED: design-principles", suffixSources),
		"software/project/standmeet/design-principles")
	onePath(t, usedPaths("USED: software/project/youteacher/deployment", suffixSources),
		"software/project/youteacher/deployment")
}

// TestUsedPathsAmbiguousAndInvented —— R1: an ambiguous tail (shared by >1 source) resolves to
// nothing (no false grounding), and an invented path never enters.
func TestUsedPathsAmbiguousAndInvented(t *testing.T) {
	t.Parallel()
	if amb := usedPaths("USED: deployment", suffixSources); len(amb) != 0 {
		t.Fatalf("ambiguous tail should not resolve: %v", amb)
	}
	if inv := usedPaths("USED: made/up/path", suffixSources); len(inv) != 0 {
		t.Fatalf("invented path leaked: %v", inv)
	}
}

// TestFinalizeGenericNoCitation —— F-3d: a generic card (USED: none) carries no From, keeps its
// marker, and reports generic mode.
func TestFinalizeGenericNoCitation(t *testing.T) {
	t.Parallel()
	in := "general answer\n_General — not from your notes._\nUSED: none"
	got := finalize(in, &cueCtx{sources: []string{"a/b"}})
	if strings.Contains(got.card, "From:") {
		t.Fatalf("generic card got a forged From line: %q", got.card)
	}
	if !strings.Contains(got.card, "General — not from your notes") || got.mode != "generic" {
		t.Fatalf("generic marker/mode lost: %q (%s)", got.card, got.mode)
	}
}

// TestFinalizeGenericMarkerStripsCitation —— V1 backstop: a card the model marked generic carries
// NO From, even if it declared a note in USED (generic judgment never cites the owner).
func TestFinalizeGenericMarkerStripsCitation(t *testing.T) {
	t.Parallel()
	in := "general judgment\n_General — not from your notes._\n" +
		"USED: software/engineering/model-to-production"
	got := finalize(in, &cueCtx{sources: []string{"software/engineering/model-to-production"}})
	if strings.Contains(got.card, "From:") || got.mode != "generic" {
		t.Fatalf("a generic-marked card still carries a From: %q (%s)", got.card, got.mode)
	}
}

// TestFinalizeProjectNeedsNaming —— V1 backstop: a project note (software/project/*) is a grounded
// citation only when the question named that project; an unnamed project's note is dropped, a named
// one is kept. A general-principle note (not a project) is always kept.
func TestFinalizeProjectNeedsNaming(t *testing.T) {
	t.Parallel()
	sources := []string{"software/project/larkspur", "software/engineering/model-to-production"}
	used := "body\nUSED: software/project/larkspur, software/engineering/model-to-production"

	// Names no project: the project note is adjacent and dropped; the principle note stays.
	unnamed := finalize(used, &cueCtx{sources: sources})
	if strings.Contains(unnamed.card, "software/project/larkspur") {
		t.Fatalf("an unnamed project's note was cited as grounding: %q", unnamed.card)
	}
	if !strings.Contains(unnamed.card, "_From: software/engineering/model-to-production_") {
		t.Fatalf("the on-point principle note was dropped: %q", unnamed.card)
	}

	// Question named Larkspur: its note is on-point and kept.
	named := finalize(used, &cueCtx{sources: sources, namedProjects: []string{"larkspur"}})
	if !strings.Contains(named.card, "software/project/larkspur") {
		t.Fatalf("a named project's note was dropped: %q", named.card)
	}
}

// TestFinalizeNoThirdState —— follow-up #2: a card with neither a marker nor a citeable USED must
// NOT stay in the gray third state — the server marks it generic. Every card ends in one state.
func TestFinalizeNoThirdState(t *testing.T) {
	t.Parallel()
	// A clean general body with no USED (the design-doc gray-card shape) → generic + marker.
	noUsed := finalize("**Key: x**\nkeep it short; lead with the decision", &cueCtx{})
	assertTwoState(t, noUsed)
	if noUsed.mode != "generic" {
		t.Fatalf("an undeclared clean card should resolve to generic, got %q", noUsed.mode)
	}

	// Declared only an unnamed project's note → filtered to empty → still not a third state.
	onlyUnnamed := finalize("a clean general note\nUSED: software/project/larkspur",
		&cueCtx{sources: []string{"software/project/larkspur"}})
	assertTwoState(t, onlyUnnamed)
	if onlyUnnamed.mode != "generic" {
		t.Fatalf("an all-filtered card should resolve to generic, got %q", onlyUnnamed.mode)
	}
}

// TestFinalizePersonalBodyGapAdmission —— R2: a would-be-generic card whose body narrates the
// owner's own experience (first person, a specific date) is never shipped with a lying marker — it
// becomes a gap-admission, which carries none of those. The 错配 defect's core.
func TestFinalizePersonalBodyGapAdmission(t *testing.T) {
	t.Parallel()
	// First-person incident, no citeable USED (the S2 Q2 shape) → a gap-admission.
	fp := finalize("**Key: outage**\nWhen it broke, I rolled back and added a check.", &cueCtx{})
	if fp.downgrade != "first_person" || fp.card != gapAdmissionCard {
		t.Fatalf("first-person body not replaced by gap-admission: %q (%s)", fp.card, fp.downgrade)
	}
	// A specific incident date trips it too (no first person, to isolate the date signal).
	dated := finalize("**Key: x**\nthe incident on 2026-08-31 ran three hours", &cueCtx{})
	if dated.downgrade != "date" {
		t.Fatalf("a dated incident body was not caught: %q (%s)", dated.card, dated.downgrade)
	}
	// Naming a project to deny it (a gap-admission) is NOT a tripwire — the body survives.
	deny := finalize("**Key: no record**\nLarkspur has no detection model.", &cueCtx{})
	if !strings.Contains(deny.card, "Larkspur has no detection model") {
		t.Fatalf("a gap-admission naming a project was wrongly nuked: %q", deny.card)
	}
}

// TestFinalizeMarkerCanonical —— R3: the server strips whatever marker wrapper the model wrote and
// stamps exactly one canonical marker line; the card carries no duplicate/variant marker.
func TestFinalizeMarkerCanonical(t *testing.T) {
	t.Parallel()
	// Model wrote an asterisk-wrapped variant; the body is clean general advice.
	got := finalize("**General — not from your notes**\nkeep stakeholders updated often", &cueCtx{})
	if strings.Count(got.card, "not from your notes") != 1 {
		t.Fatalf("expected exactly one marker, got: %q", got.card)
	}
	if !strings.HasPrefix(got.card, genericMarkerLine) {
		t.Fatalf("card does not lead with the canonical marker: %q", got.card)
	}
	if strings.Contains(got.card, "**General") {
		t.Fatalf("the model's marker variant survived: %q", got.card)
	}
}

// TestFinalizePostingIsGrounded —— a process answer drawn from the posting (USED: posting, packet
// present) is grounded on "the role's posting", not marked general (H2 fits the two states).
func TestFinalizePostingIsGrounded(t *testing.T) {
	t.Parallel()
	got := finalize("band answer\nUSED: posting", &cueCtx{posting: postingCitation})
	if got.mode != "grounded" || !strings.Contains(got.card, "_From: the role's posting_") {
		t.Fatalf("posting answer not grounded on the posting: %q (%s)", got.card, got.mode)
	}
	if strings.Contains(got.card, "not from your notes") {
		t.Fatalf("posting answer wrongly marked general: %q", got.card)
	}
	// Without a posting in the packet, a stray "USED: posting" cites nothing → generic, not forged.
	none := finalize("a clean general note\nUSED: posting", &cueCtx{})
	if none.mode != "generic" {
		t.Fatalf("posting citation forged without a packet: %q", none.card)
	}
}

// assertTwoState —— the invariant: generic (marker, no From) XOR grounded (From, no marker).
func assertTwoState(t *testing.T, f finished) {
	t.Helper()
	marker := strings.Contains(f.card, "not from your notes")
	from := strings.Contains(f.card, "_From:")
	if marker == from {
		t.Fatalf("not in exactly one state (marker=%v from=%v): %q", marker, from, f.card)
	}
}
