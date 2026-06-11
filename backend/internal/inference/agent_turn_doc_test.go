package inference

import (
	"strings"
	"testing"
)

// instructionWithDoc —— #36 位置感知的核心:把访客当前 doc 注进 instruction 让代词
// 指代解析。e2e(floating-chat-dock)验请求带了 doc_context;这里验 backend 真把它
// 拼进 instruction(eval gateway 在 CI 跑不了,单测锁住注入逻辑)。
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
