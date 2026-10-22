// prompt_internal_test.go —— pure, PII-free checks on the cue system prompt's structure.

package cues

import (
	"strings"
	"testing"
)

// TestGenericCoachingSectionToggles —— cue-layered-grounding H3: the generic-coaching section is in
// the prompt only when the caller enables it; off by default.
func TestGenericCoachingSectionToggles(t *testing.T) {
	t.Parallel()
	on := systemPrompt("ctx", "rules", cuesGenericCoaching)
	off := systemPrompt("ctx", "rules", "")
	if !strings.Contains(on, "GENERIC COACHING") || !strings.Contains(on, "General advice") {
		t.Fatal("generic coaching enabled but its section is absent from the prompt")
	}
	if strings.Contains(off, "GENERIC COACHING") {
		t.Fatal("generic coaching disabled but its section is in the prompt")
	}
}

// TestDisciplineAlwaysPresent —— the answer-as-asked / gap / no-bridge / process-facts discipline
// closes every prompt, coaching on or off (cue-defect-loop, cue-gap-discipline, H2).
func TestDisciplineAlwaysPresent(t *testing.T) {
	t.Parallel()
	for _, coaching := range []string{cuesGenericCoaching, ""} {
		p := systemPrompt("ctx", "rules", coaching)
		if !strings.Contains(p, "ANSWER THE QUESTION ACTUALLY ASKED") {
			t.Fatalf("discipline block missing (coaching=%q)", coaching)
		}
	}
}
