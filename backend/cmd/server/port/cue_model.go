// cue_model.go —— the cue card's model port: the role's provider (or the owner's default),
// streamed, billed to the owner's usage like any host call.

package port

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

const (
	cueMaxTokens = 800
	// cueModel —— a card has to land within a second: on DeepSeek it runs the fast model with
	// thinking off (first token 0.8 s; 3 s of reasoning otherwise, measured 2026-09-27), whatever
	// model the owner's provider is set to for visitor chat. Another provider runs its own model.
	cueModel        = "deepseek-flash"
	providerDeep    = "deepseek"
	providerClaude  = "anthropic"
	cueUsageFeature = "screen_assistant"
)

type cueModelFunc = func(
	ctx context.Context, ownerID, providerID string, req cues.ModelRequest, onText func(string),
) (string, string, error)

func cueModelCall(d *deps.Runtime) cueModelFunc {
	return func(
		ctx context.Context, ownerID, providerID string, req cues.ModelRequest, onText func(string),
	) (string, string, error) {
		tgt := cueCodeModel(ctx, d, ownerID, providerID, req.Code)
		cred, err := d.ProviderResolver.Resolve(ctx, &inference.ResolveInput{
			OwnerID: ownerID, ProviderID: tgt.provider, Model: tgt.model,
		})
		if err != nil {
			return "", "", fmt.Errorf("the owner's provider: %w", err)
		}
		chat, opt := cueChat(cred, req, tgt.model)
		used := &inference.UsageMeter{}
		metered := inference.WithUsageMeter(ctx, used)
		text, err := inference.StreamText(metered, cred, chat, opt, onText)
		model := cred.Model
		if chat.Model != "" {
			model = chat.Model
		}
		billCue(ctx, d, ownerID, model, used)
		return model, text, err
	}
}

// cueCodeModel —— the provider and model a bound access code pins for its card: the code's provider
// wins over the role's (access_codes.provider_id), and the code's model over that provider's own
// (access_codes.model). No code, a parse miss, or a code of another owner → the role's provider and
// no model override (today's behaviour); a best-effort read never fails the card.
// cueTarget —— the provider id and model-override a bound code resolves to for its card.
type cueTarget struct {
	provider string
	model    string
}

func cueCodeModel(
	ctx context.Context, d *deps.Runtime, ownerID, roleProvider, code string,
) cueTarget {
	if code == "" {
		return cueTarget{provider: roleProvider}
	}
	c, err := d.CodeRepo.GetByID(ctx, code)
	if err != nil || c.OwnerID != ownerID {
		return cueTarget{provider: roleProvider}
	}
	provider := roleProvider
	if c.ProviderID != "" {
		provider = c.ProviderID
	}
	return cueTarget{provider: provider, model: c.Model}
}

// cueChat —— the request: DeepSeek runs cueModel; DeepSeek and Anthropic run with thinking off
// (Claude 5.5 Haiku thinks by default and spent the whole budget on it: no card at all). Other
// openai-compat providers get no switch they may not know. A code that pinned its own model
// (override, already on cred.Model via the resolver) wins even over DeepSeek's fast default.
func cueChat(
	cred *inference.Cred, req cues.ModelRequest, override string,
) (*inference.ChatRequest, inference.StreamOptions) {
	chat := &inference.ChatRequest{System: req.System, MaxTokens: cueMaxTokens}
	for _, m := range req.Messages {
		msg := inference.ChatRequestMsg{Role: m.Role, Content: m.Content}
		chat.Messages = append(chat.Messages, msg)
	}
	switch cred.Provider {
	case providerDeep:
		chat.Model = cueModel
		if override != "" {
			chat.Model = override
		}
		return chat, inference.StreamOptions{NoThinking: true}
	case providerClaude:
		return chat, inference.StreamOptions{NoThinking: true}
	}
	return chat, inference.StreamOptions{}
}

func billCue(
	ctx context.Context, d *deps.Runtime, ownerID, model string, used *inference.UsageMeter,
) {
	if d.InferenceUsageRepo == nil || (used.In == 0 && used.Out == 0) {
		return
	}
	if err := d.InferenceUsageRepo.Record(ctx, &stats.UsageRow{
		OwnerID: ownerID, Model: model, Feature: cueUsageFeature,
		InputTokens: used.In, OutputTokens: used.Out, CachedTokens: used.Cached,
	}); err != nil {
		d.Log.Warn("record cue usage", "err", err)
	}
}
