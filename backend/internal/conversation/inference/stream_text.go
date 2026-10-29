// stream_text.go —— a one-shot streaming call for an owner-side caller that shows the text as
// it grows (the screen assistant's cue card: the owner reads the first line while the rest is
// still being written). No tools, no SSE: onText gets the whole text so far after each chunk.

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// thinkingOff —— the switch for a reply without reasoning first, a top-level request field neither
// adapter models. The spelling is now model-specific on Anthropic: Sonnet 5.5 / Opus 5.5 reject
// "disabled" ("send between_tools instead" — 400) and want "between_tools"; Haiku 5.5 and the older
// Claude 5 / 4.x models keep "disabled" (accepted at effort <= high, which is the default here).
// For a no-tools cue call both spellings mean the same thing: no reasoning before the answer.
var (
	thinkingOffDisabled    = json.RawMessage(`{"thinking":{"type":"disabled"}}`)
	thinkingOffBetweenTool = json.RawMessage(`{"thinking":{"type":"between_tools"}}`)
)

// thinkingOffAnthropic —— the "thinking off" field for one Claude model. Defaults to "disabled"
// (the long-standing spelling) for any model not known to require the newer "between_tools".
func thinkingOffAnthropic(modelID string) json.RawMessage {
	if strings.Contains(modelID, "sonnet-5-5") || strings.Contains(modelID, "opus-5-5") {
		return thinkingOffBetweenTool
	}
	return thinkingOffDisabled
}

// StreamOptions —— how StreamText asks.
type StreamOptions struct {
	// NoThinking —— turn the model's thinking off. A model that thinks by default (Claude 5.5
	// Haiku) spends a small budget on thinking and writes no text at all: the screen
	// assistant's 800-token card came back empty every time (prod, 2026-10-20).
	NoThinking bool
}

// StreamText —— runs req on cred (req.Model overrides the provider's model) and returns the
// finished text. Tokens are added to a UsageMeter on ctx, as Generate does.
func StreamText(
	ctx context.Context, cred *Cred, req *ChatRequest, opt StreamOptions, onText func(string),
) (string, error) {
	sr, err := openStream(ctx, pickModelCred(cred, req.Model), req, opt)
	if err != nil {
		return "", err
	}
	defer sr.Close()
	var got streamed
	for {
		chunk, rerr := sr.Recv()
		if errors.Is(rerr, io.EOF) {
			return got.finished()
		}
		if rerr != nil {
			return got.text.String(), fmt.Errorf("eino: stream recv: %w", rerr)
		}
		got.add(ctx, chunk, onText)
	}
}

// ErrNoText —— the stream ended without a word of text.
var ErrNoText = errors.New("the model wrote no text")

// streamed —— the text so far and why the stream stopped.
type streamed struct {
	stop string
	text strings.Builder
}

// add —— one chunk: its usage metered, its text added and shown, its stop reason kept.
func (g *streamed) add(ctx context.Context, chunk *schema.Message, onText func(string)) {
	meterChunk(ctx, chunk)
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.FinishReason != "" {
		g.stop = chunk.ResponseMeta.FinishReason
	}
	if chunk.Content != "" {
		g.text.WriteString(chunk.Content)
		onText(g.text.String())
	}
}

// finished —— the whole text; a stream that ended with none says why it stopped (a budget
// spent on thinking reads "max_tokens").
func (g *streamed) finished() (string, error) {
	if g.text.Len() == 0 {
		return "", fmt.Errorf("%w (stop reason %q)", ErrNoText, g.stop)
	}
	return g.text.String(), nil
}

func openStream(
	ctx context.Context, c *Cred, req *ChatRequest, opt StreamOptions,
) (*schema.StreamReader[*schema.Message], error) {
	cm, err := streamModel(ctx, c, outputBudget(req.MaxTokens), opt)
	if err != nil {
		return nil, fmt.Errorf("eino: build chat model: %w", err)
	}
	msgs, err := toEinoMessages(req.System, req.Messages)
	if err != nil {
		return nil, err
	}
	sr, err := cm.Stream(ctx, msgs)
	if err != nil {
		return nil, fmt.Errorf("eino: stream: %w", err)
	}
	return sr, nil
}

// streamModel —— BuildChatModelBudgeted, with the thinking switch in the request body.
func streamModel(
	ctx context.Context, c *Cred, tok int, opt StreamOptions,
) (model.ToolCallingChatModel, error) {
	if !opt.NoThinking {
		return BuildChatModelBudgeted(ctx, c, tok)
	}
	if err := checkCredBasics(c); err != nil {
		return nil, err
	}
	if err := validateUntrustedEndpoint(ctx, c); err != nil {
		return nil, err
	}
	if c.Provider == providerAnthrop {
		return buildClaudeModelWith(ctx, c, tok, func(cfg *claude.Config) error {
			return json.Unmarshal(thinkingOffAnthropic(c.Model), &cfg.AdditionalRequestFields)
		})
	}
	return buildOpenAICompatModelWith(ctx, c, tok, func(cfg *openai.ChatModelConfig) error {
		return json.Unmarshal(thinkingOffDisabled, &cfg.ExtraFields)
	})
}

// meterChunk —— a stream reports its usage on one chunk (usually the last).
func meterChunk(ctx context.Context, chunk *schema.Message) {
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.Usage != nil {
		meterGenerate(ctx, chunk.ResponseMeta)
	}
}
