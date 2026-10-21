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

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// thinkingOff —— DeepSeek's switch for a reply without reasoning first (a top-level request
// field the openai-compat client does not model).
var thinkingOff = json.RawMessage(`{"thinking":{"type":"disabled"}}`)

// StreamOptions —— how StreamText asks.
type StreamOptions struct {
	// NoThinking —— send DeepSeek's thinking switch off (openai-compat providers only).
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
	var text strings.Builder
	for {
		chunk, rerr := sr.Recv()
		if errors.Is(rerr, io.EOF) {
			return text.String(), nil
		}
		if rerr != nil {
			return text.String(), fmt.Errorf("eino: stream recv: %w", rerr)
		}
		grow(ctx, &text, chunk, onText)
	}
}

// grow —— one chunk: its usage metered, its text added and shown.
func grow(ctx context.Context, text *strings.Builder, chunk *schema.Message, onText func(string)) {
	meterChunk(ctx, chunk)
	if chunk.Content != "" {
		text.WriteString(chunk.Content)
		onText(text.String())
	}
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

// streamModel —— BuildChatModelBudgeted, with the thinking switch on an openai-compat body.
func streamModel(
	ctx context.Context, c *Cred, tok int, opt StreamOptions,
) (model.ToolCallingChatModel, error) {
	if !opt.NoThinking || c.Provider == providerAnthrop {
		return BuildChatModelBudgeted(ctx, c, tok)
	}
	if err := checkCredBasics(c); err != nil {
		return nil, err
	}
	if err := validateUntrustedEndpoint(ctx, c); err != nil {
		return nil, err
	}
	return buildOpenAICompatModelWith(ctx, c, tok, func(cfg *openai.ChatModelConfig) error {
		return json.Unmarshal(thinkingOff, &cfg.ExtraFields)
	})
}

// meterChunk —— a stream reports its usage on one chunk (usually the last).
func meterChunk(ctx context.Context, chunk *schema.Message) {
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.Usage != nil {
		meterGenerate(ctx, chunk.ResponseMeta)
	}
}
