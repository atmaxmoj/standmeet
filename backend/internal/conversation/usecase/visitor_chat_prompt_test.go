// visitor_chat_prompt_test.go —— #104 per-code prompt: a code's own prompt stacks into
// the session persona. ComposeDynamicPersona appends the code prompt after the role
// persona; when no code prompt is attached, the output stays byte-identical to before
// (keeps system-prompt-hash-regression honest).

package usecase

import (
	"strings"
	"testing"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

func snapWithPrompts(rolePrompt, codePrompt string) *access.RoleSnapshot {
	s := access.NewRoleSnapshot(&access.RoleSnapshotInit{
		PromptBody:     rolePrompt,
		CodePromptBody: codePrompt,
	})
	return &s
}

func TestComposeDynamicPersona_AppendsCodePrompt(t *testing.T) {
	t.Parallel()
	out := ComposeDynamicPersona(
		snapWithPrompts("You are Alice's assistant.", "For THIS code: focus on hiring."), "",
	)
	if !strings.Contains(out, "You are Alice's assistant.") {
		t.Fatalf("role persona missing: %q", out)
	}
	if !strings.Contains(out, "For THIS code: focus on hiring.") {
		t.Fatalf("code prompt missing: %q", out)
	}
	// additive, and the role persona comes first (code prompt specializes it).
	if strings.Index(out, "You are Alice") > strings.Index(out, "For THIS code") {
		t.Fatalf("code prompt should come after the role persona: %q", out)
	}
}

func TestComposeDynamicPersona_NoCodePrompt_ByteForByteUnchanged(t *testing.T) {
	t.Parallel()
	// A code with no prompt (or any non-code session) must produce EXACTLY the role-only
	// persona — no separator, no empty part — so existing sessions' system-prompt hash is stable.
	out := ComposeDynamicPersona(snapWithPrompts("You are Alice's assistant.", ""), "")
	if out != "You are Alice's assistant." {
		t.Fatalf("empty code prompt must leave the persona byte-for-byte unchanged, got %q", out)
	}
}

func TestComposeDynamicPersona_CodePromptOnly(t *testing.T) {
	t.Parallel()
	// public role (empty persona) + a code prompt → just the code prompt, no leading separator.
	out := ComposeDynamicPersona(snapWithPrompts("", "Only the code speaks."), "")
	if out != "Only the code speaks." {
		t.Fatalf("code-prompt-only persona wrong: %q", out)
	}
}

// TestComposeDynamicPersona_OwnerIdentityLeads —— UX-66: the name comes first, ahead of
// the role persona. A real visitor goes through the dynamic branch, so identity must be
// delivered **here**, not only in the base branch.
func TestComposeDynamicPersona_OwnerIdentityLeads(t *testing.T) {
	t.Parallel()
	out := ComposeDynamicPersona(snapWithPrompts("Speak plainly.", ""), "Alice Zhang")
	if !strings.Contains(out, "Alice Zhang") {
		t.Fatalf("the persona must say who the owner is: %q", out)
	}
	if strings.Index(out, "Alice Zhang") > strings.Index(out, "Speak plainly.") {
		t.Fatalf("identity comes before the role persona: %q", out)
	}
}
