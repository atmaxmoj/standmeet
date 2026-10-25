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

// TestStampFromDropsForged —— F-2: the From line is the server's, built from the real sources; a
// forged node and any model-written From line are dropped.
func TestStampFromDropsForged(t *testing.T) {
	t.Parallel()
	sources := []string{"software/engineering/model-to-production", "cv"}
	in := "**Key: x**\nbody line\n_From: forged-node, another-forgery_\n" +
		"USED: software/engineering/model-to-production, ghost/node, cv"
	got := stampFrom(in, sources)
	for _, forged := range []string{"forged-node", "another-forgery", "ghost/node", "USED:"} {
		if strings.Contains(got, forged) {
			t.Fatalf("control/forged content survived (%q): %q", forged, got)
		}
	}
	if !strings.Contains(got, "_From: software/engineering/model-to-production, cv_") {
		t.Fatalf("real sources not stamped: %q", got)
	}
	// A path the model copied with the surrounding "(…)" from the context header is still matched.
	paren := stampFrom("body\nUSED: (cv), (software/engineering/model-to-production)", sources)
	if !strings.Contains(paren, "_From: cv, software/engineering/model-to-production_") {
		t.Fatalf("parenthesised USED paths were not matched: %q", paren)
	}
}

// TestStampFromNoneNoCitation —— F-3d: a generic card (USED: none) carries no From line, and its
// general marker survives stamping.
func TestStampFromNoneNoCitation(t *testing.T) {
	t.Parallel()
	in := "general answer\n_General — not from your notes._\nUSED: none"
	got := stampFrom(in, []string{"a/b"})
	if strings.Contains(got, "From:") {
		t.Fatalf("generic card got a forged From line: %q", got)
	}
	if !strings.Contains(got, "General — not from your notes") {
		t.Fatalf("generic marker stripped by mistake: %q", got)
	}
}
