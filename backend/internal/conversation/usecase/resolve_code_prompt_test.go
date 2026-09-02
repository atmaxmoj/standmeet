// resolve_code_prompt_test.go —— resolution semantics from the #104 extension: an inline
// per-code prompt wins over a prompt_id library reference. When inline is non-empty,
// **returns it directly, without touching deps** (the persona the code-issuer attached to
// the code, no library lookup) —— core injects this segment blindly, unaware of the
// semantics.

package usecase

import (
	"context"
	"testing"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

func TestResolveCodePromptInlineWins(t *testing.T) {
	t.Parallel()
	// InlinePrompt non-empty → returned verbatim, without touching deps (nil-safe):
	// proves inline wins and skips the library lookup.
	code := &access.Code{
		InlinePrompt: "You are speaking with a recruiter for Backend Engineer.",
	}
	got, err := resolveCodePrompt(context.Background(), nil, code)
	if err != nil {
		t.Fatalf("inline resolution must not error (deps untouched): %v", err)
	}
	if got != code.InlinePrompt {
		t.Fatalf("inline prompt should win verbatim: got %q, want %q", got, code.InlinePrompt)
	}
}
