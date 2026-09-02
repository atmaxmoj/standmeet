package inference

import (
	"strings"
	"testing"
)

// instructionWithDoc —— the core of #36 location-awareness: injects the visitor's current doc
// into the instruction for pronoun reference resolution. e2e (floating-chat-dock) verifies the
// request carries doc_context; this file verifies the backend really appends it into the
// instruction (the eval gateway can't run in CI, so a unit test locks down the injection logic).
const docTestPersona = "You are the owner."

func TestInstructionWithDocNil(t *testing.T) {
	t.Parallel()
	if got := instructionWithDoc(docTestPersona, nil); got != docTestPersona {
		t.Fatalf("nil doc should pass through, got %q", got)
	}
}

func TestInstructionWithDocEmptyTitle(t *testing.T) {
	t.Parallel()
	doc := &AgentDocContext{Path: "projects/lucerna", Genre: "wiki"}
	if got := instructionWithDoc(docTestPersona, doc); got != docTestPersona {
		t.Fatalf("empty title should pass through, got %q", got)
	}
}

func TestInstructionWithDocFull(t *testing.T) {
	t.Parallel()
	doc := &AgentDocContext{Title: "Lucerna", Path: "projects/lucerna", Genre: "wiki"}
	got := instructionWithDoc(docTestPersona, doc)
	if got == docTestPersona {
		t.Fatal("expected doc context appended, got unchanged persona")
	}
	wants := []string{docTestPersona, "Lucerna", "/wiki/projects/lucerna", "\"this\""}
	for _, want := range wants {
		if !strings.Contains(got, want) {
			t.Fatalf("instruction missing %q\n--- got ---\n%s", want, got)
		}
	}
}

func TestInstructionWithDocTitleOnly(t *testing.T) {
	t.Parallel()
	got := instructionWithDoc(docTestPersona, &AgentDocContext{Title: "Lucerna"})
	if !strings.Contains(got, "Lucerna") || strings.Contains(got, "(/") {
		t.Fatalf("title-only should mention title without a path paren, got %q", got)
	}
}
