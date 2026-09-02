// Package inference —— the LLM call layer. Uniformly goes through cloudwego/eino's
// model.ToolCallingChatModel abstraction; the provider (anthropic / openai-compat / gemini /
// ollama) picks the adapter via Cred.Provider. Two call shapes:
//
//   - Stream (proxy.go)   —— streaming SSE, drives the browser's pi-agent-core chat agent
//     loop
//   - Generate (generate.go) —— returns text in one shot, reused by visitor_summary / future
//     capabilities
//
// Cred + Resolver live in resolver.go; errors.go holds the sentinels + status classification.
//
// eino_model.go —— constructs one eino model.ToolCallingChatModel from an owner / visitor
// BYOAI cred. Selects the provider-specific adapter underneath (claude / openai / openai-compat
// via baseURL override), exposing a uniform ChatModel interface to callers.
//
// Model instances aren't cached — one is constructed per chat request; construction is cheap
// (just wiring up an HTTP client + config), which avoids the complexity of cache invalidation
// and clearing it out after the owner changes their cred.
package inference

import (
	"context"
	"errors"
	"fmt"

	"github.com/cloudwego/eino-ext/components/model/claude"
	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	// defaultMaxTokens —— the output cap for one reply. 1024 would cut a substantial
	// several-hundred-word answer off mid-sentence (every answer got truncated in eval
	// interviews). 4096 gives a complete chat reply enough headroom, without letting a single
	// turn's cost run away.
	defaultMaxTokens = 4096
	providerOpenAI   = "openai"
	providerAnthrop  = "anthropic"
)

// BoundaryMaxTokens —— the boundary synthesis's (forceFinalAnswer's) own output budget.
//
// **Why it can't use the default 4096**: measured while driving F-A-40's item 5 in prod — the
// boundary did fire (`forcing synthesis from evidence evidence_items:24`), but 40 seconds later
// came back **an empty string, no error**, so that turn still ended up `answer_chars:0`. The
// owner's setup uses a reasoning model (deepseek-v4-pro), whose thinking tokens share the same
// output budget as the body text: asking it to synthesize twenty-odd evidence items into one
// passage burned all 4096 on thinking, leaving not a single character for content.
//
// This is literally this very defect's own lesson **happening again**: any budget can be
// exhausted, so the rescue step must not share its budget with the step it's trying to rescue.
// The boundary gets its own, larger allowance.
const BoundaryMaxTokens = 12288

// BuildChatModel —— picks the specific adapter based on cred. anthropic goes through its own
// Messages API; every other provider (deepseek / kimi / groq / together / openrouter /
// siliconflow / custom self-host) goes through the openai-compat /v1/chat/completions API,
// with BaseURL decided by cred.Endpoint.
//
//nolint:ireturn // dispatch by provider; caller holds the model.ToolCallingChatModel interface
func BuildChatModel(ctx context.Context, cred *Cred) (model.ToolCallingChatModel, error) {
	return BuildChatModelBudgeted(ctx, cred, 0)
}

// BuildChatModelBudgeted —— same as above, but the caller can specify this call's output
// budget (0 = use the default). Only the boundary synthesis needs this (see
// BoundaryMaxTokens): everywhere else should use the same default value, otherwise "how long
// can one answer be" turns into constants scattered all over the place.
//
//nolint:ireturn // dispatch by provider; caller holds the model.ToolCallingChatModel interface
func BuildChatModelBudgeted(
	ctx context.Context, cred *Cred, maxTokens int,
) (model.ToolCallingChatModel, error) {
	if err := checkCredBasics(cred); err != nil {
		return nil, err
	}
	if verr := validateUntrustedEndpoint(ctx, cred); verr != nil {
		return nil, verr
	}
	tok := outputBudget(maxTokens)
	if cred.Provider == providerAnthrop {
		return buildClaudeModel(ctx, cred, tok)
	}
	if _, known := Lookup(cred.Provider); !known {
		return nil, fmt.Errorf("eino: unknown provider %q", cred.Provider)
	}
	return buildOpenAICompatModel(ctx, cred, tok)
}

// outputBudget —— uses what the caller gave if it gave something, the default otherwise.
// "How long can one answer be" is defined exactly once, right here.
func outputBudget(requested int) int {
	if requested > 0 {
		return requested
	}
	return defaultMaxTokens
}

func checkCredBasics(cred *Cred) error {
	if cred == nil {
		return errors.New("eino: cred required")
	}
	if cred.Model == "" {
		return errors.New("eino: cred.Model required")
	}
	return nil
}

// validateUntrustedEndpoint —— an Untrusted (BYOAI) endpoint is visitor-controlled → refuse an
// internal/private target before any dial (SSRF). Wraps httpx.ErrBlockedEgress so ClassifyStreamErr
// names the address policy. Owner creds (trusted self-host config) are not checked.
func validateUntrustedEndpoint(ctx context.Context, cred *Cred) error {
	if !cred.Untrusted || cred.Endpoint == "" {
		return nil
	}
	if verr := httpx.ValidatePublicURL(ctx, cred.Endpoint); verr != nil {
		return fmt.Errorf("eino: byoai endpoint: %w", verr)
	}
	return nil
}

//nolint:ireturn // dispatch helper returns the interface BuildChatModel exposes
func buildClaudeModel(
	ctx context.Context, cred *Cred, maxTok int,
) (model.ToolCallingChatModel, error) {
	cfg := &claude.Config{
		APIKey:    cred.Key,
		Model:     cred.Model,
		MaxTokens: maxTok,
	}
	if cred.Endpoint != "" {
		ep := cred.Endpoint
		cfg.BaseURL = &ep
	}
	cm, err := claude.NewChatModel(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("eino: claude model: %w", err)
	}
	return cm, nil
}

//nolint:ireturn // dispatch helper returns the interface BuildChatModel exposes
func buildOpenAICompatModel(
	ctx context.Context, cred *Cred, maxTok int,
) (model.ToolCallingChatModel, error) {
	cfg := &openai.ChatModelConfig{
		APIKey:    cred.Key,
		Model:     cred.Model,
		MaxTokens: &maxTok,
		// The retry transport: automatically retries a transient failure (connection error /
		// 429 / 5xx) before response headers arrive, never retries a ctx cancellation or
		// already-streamed tokens. See http_retry.go. An untrusted (BYOAI) endpoint gets an
		// SSRF-guarding dialer wired in (blocks DNS-rebind too).
		HTTPClient: retryHTTPClient(cred.Untrusted),
	}
	if cred.Endpoint != "" {
		cfg.BaseURL = cred.Endpoint
	}
	cm, err := openai.NewChatModel(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("eino: openai-compat model: %w", err)
	}
	return cm, nil
}
