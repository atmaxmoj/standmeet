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
	got := finalize(in, sources, nil, "")
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
	paren := finalize(parenIn, sources, nil, "")
	if !strings.Contains(paren.card, "_From: cv, software/engineering/model-to-production_") {
		t.Fatalf("parenthesised USED paths were not matched: %q", paren.card)
	}
}

// TestFinalizeGenericNoCitation —— F-3d: a generic card (USED: none) carries no From, keeps its
// marker, and reports generic mode.
func TestFinalizeGenericNoCitation(t *testing.T) {
	t.Parallel()
	in := "general answer\n_General — not from your notes._\nUSED: none"
	got := finalize(in, []string{"a/b"}, nil, "")
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
	got := finalize(in, []string{"software/engineering/model-to-production"}, nil, "")
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
	unnamed := finalize(used, sources, nil, "")
	if strings.Contains(unnamed.card, "software/project/larkspur") {
		t.Fatalf("an unnamed project's note was cited as grounding: %q", unnamed.card)
	}
	if !strings.Contains(unnamed.card, "_From: software/engineering/model-to-production_") {
		t.Fatalf("the on-point principle note was dropped: %q", unnamed.card)
	}

	// Question named Larkspur: its note is on-point and kept.
	named := finalize(used, sources, []string{"larkspur"}, "")
	if !strings.Contains(named.card, "software/project/larkspur") {
		t.Fatalf("a named project's note was dropped: %q", named.card)
	}
}

// TestFinalizeNoThirdState —— acceptance follow-up #2: a card with neither a general marker nor a
// citeable USED (the model omitted USED, or its only declared note was an unnamed project) must NOT
// stay in the gray third state — the server marks it generic. Every card ends in one of two states.
func TestFinalizeNoThirdState(t *testing.T) {
	t.Parallel()
	// The model omitted USED entirely (the design-doc / V4-Q2 gray-card shape).
	noUsed := finalize("**Key: x**\nmethodology body, D-x tags, red-contract tests", nil, nil, "")
	assertTwoState(t, noUsed)
	if noUsed.mode != "generic" {
		t.Fatalf("an undeclared card should resolve to generic, got %q", noUsed.mode)
	}

	// Declared only an unnamed project's note → filtered to empty → still not a third state.
	onlyUnnamed := finalize("body\nUSED: software/project/larkspur",
		[]string{"software/project/larkspur"}, nil, "")
	assertTwoState(t, onlyUnnamed)
	if onlyUnnamed.mode != "generic" {
		t.Fatalf("an all-filtered card should resolve to generic, got %q", onlyUnnamed.mode)
	}
}

// TestFinalizePostingIsGrounded —— a process answer drawn from the posting (USED: posting, packet
// present) is grounded on "the role's posting", not marked general (H2 fits the two states).
func TestFinalizePostingIsGrounded(t *testing.T) {
	t.Parallel()
	got := finalize("band answer\nUSED: posting", nil, nil, postingCitation)
	if got.mode != "grounded" || !strings.Contains(got.card, "_From: the role's posting_") {
		t.Fatalf("posting answer not grounded on the posting: %q (%s)", got.card, got.mode)
	}
	if strings.Contains(got.card, "not from your notes") {
		t.Fatalf("posting answer wrongly marked general: %q", got.card)
	}
	// Without a posting in the packet, a stray "USED: posting" cites nothing → generic, not forged.
	none := finalize("x\nUSED: posting", nil, nil, "")
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
