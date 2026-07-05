// resolve_code_prompt_test.go —— #104 扩展的取值语义：内联 per-code prompt 优先于 prompt_id 库引用。
// 内联非空时**直接返回、不碰 deps**（发码方随码带的 persona，不查库）——core 无脑注入这段，不知语义。

package usecases

import (
	"context"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func TestResolveCodePromptInlineWins(t *testing.T) {
	t.Parallel()
	// InlinePrompt 非空 → 原样返回，且不触碰 deps（nil-safe）：证明内联优先且不查库。
	code := &domain.AccessCode{
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
