// generate.go —— a one-shot, non-streaming LLM call. The caller (visitor_summary) feeds in a
// ChatRequest and gets back a piece of text. Goes through eino model.BaseChatModel.Generate;
// the provider is decided by cred.Provider, sharing the same source as proxy.Stream.
//
// The only difference from Stream is "no SSE opened / no chunks yielded" — the request shape is
// identical, so this reuses ChatRequest + toEinoMessages directly, saving a whole set of types.

package inference

import (
	"context"
	"fmt"
)

// Generate —— builds a ChatModel + runs Generate; returns the assistant content.
// The Tools field is allowed to carry tools (eino will send them upstream), but
// visitor_summary currently doesn't pass any.
func Generate(ctx context.Context, cred *Cred, req *ChatRequest) (string, error) {
	cm, err := BuildChatModelBudgeted(ctx, pickModelCred(cred, req.Model), req.MaxTokens)
	if err != nil {
		return "", fmt.Errorf("eino: build chat model: %w", err)
	}
	einoMsgs, merr := toEinoMessages(req.System, req.Messages)
	if merr != nil {
		return "", merr
	}
	out, gerr := cm.Generate(ctx, einoMsgs)
	if gerr != nil {
		return "", fmt.Errorf("eino: generate: %w", gerr)
	}
	return out.Content, nil
}
