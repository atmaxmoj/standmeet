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

	"github.com/cloudwego/eino/schema"
)

// UsageMeter —— the tokens of every Generate call made under a ctx that carries it. A visitor
// turn's own model calls are counted from its event stream; the one-shot calls around it (the
// ghost policy, a forced final answer) and a plugin's host generation were counted nowhere.
type UsageMeter struct {
	In, Out, Cached int
}

type usageMeterKey struct{}

// WithUsageMeter —— Generate calls under the returned ctx add their tokens to m.
func WithUsageMeter(ctx context.Context, m *UsageMeter) context.Context {
	return context.WithValue(ctx, usageMeterKey{}, m)
}

func meterGenerate(ctx context.Context, meta *schema.ResponseMeta) {
	m, ok := ctx.Value(usageMeterKey{}).(*UsageMeter)
	if !ok || meta == nil || meta.Usage == nil {
		return
	}
	m.In += meta.Usage.PromptTokens
	m.Out += meta.Usage.CompletionTokens
	m.Cached += meta.Usage.PromptTokenDetails.CachedTokens
}

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
	meterGenerate(ctx, out.ResponseMeta)
	return out.Content, nil
}
