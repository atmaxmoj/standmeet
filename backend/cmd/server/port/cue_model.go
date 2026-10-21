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
	cueUsageFeature = "screen_assistant"
)

type cueModelFunc = func(
	ctx context.Context, ownerID, providerID string, req cues.ModelRequest, onText func(string),
) (string, string, error)

func cueModelCall(d *deps.Runtime) cueModelFunc {
	return func(
		ctx context.Context, ownerID, providerID string, req cues.ModelRequest, onText func(string),
	) (string, string, error) {
		cred, err := d.ProviderResolver.Resolve(ctx, &inference.ResolveInput{
			OwnerID: ownerID, ProviderID: providerID,
		})
		if err != nil {
			return "", "", fmt.Errorf("the owner's provider: %w", err)
		}
		chat, opt := cueChat(cred, req)
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

// cueChat —— the request: DeepSeek runs cueModel with thinking off.
func cueChat(
	cred *inference.Cred, req cues.ModelRequest,
) (*inference.ChatRequest, inference.StreamOptions) {
	chat := &inference.ChatRequest{System: req.System, MaxTokens: cueMaxTokens}
	for _, m := range req.Messages {
		msg := inference.ChatRequestMsg{Role: m.Role, Content: m.Content}
		chat.Messages = append(chat.Messages, msg)
	}
	if cred.Provider != providerDeep {
		return chat, inference.StreamOptions{}
	}
	chat.Model = cueModel
	return chat, inference.StreamOptions{NoThinking: true}
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
