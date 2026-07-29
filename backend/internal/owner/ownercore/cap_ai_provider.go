package ownercore

// cap_ai_provider.go —— owner-MCP 只读面 for AI provider presets。1 tool:
// ai_provider.presets（列内置 provider 预设：name/label/base_url/key_prefix，
// mirror admin GET /api/admin/ai-provider/presets）。纯静态；presets 由 boot 期
// 注入（内置表在 internal/inference，ownercore 不直接依赖它）。owner-only。

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
)

const capAIProviderBundle = "ai_provider.bundle"

// AIProviderPreset —— one built-in provider preset (boot-injected so ownercore
// stays free of the inference package). Mirrors inference.ProviderPreset's owner-
// facing fields.
type AIProviderPreset struct {
	Name      string `json:"name"`
	Label     string `json:"label"`
	BaseURL   string `json:"base_url"`
	KeyPrefix string `json:"key_prefix"`
}

type aiProviderCapability struct {
	log     *slog.Logger
	presets []AIProviderPreset
}

func newAIProviderCapability(
	presets []AIProviderPreset, log *slog.Logger,
) *aiProviderCapability {
	return &aiProviderCapability{presets: presets, log: log}
}

func (*aiProviderCapability) ID() string          { return capAIProviderBundle }
func (*aiProviderCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*aiProviderCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*aiProviderCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*aiProviderCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *aiProviderCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.presetsBinding()}
}

func (c *aiProviderCapability) presetsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "ai_provider.presets",
		Description: "List the built-in AI provider presets (name, label, base_url, key_prefix) " +
			"for configuring the owner's chat inference provider.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handlePresets,
	}
}

func (c *aiProviderCapability) handlePresets(
	_ context.Context, _ string, _ json.RawMessage,
) capreg.MCPResult {
	return mcputil.MarshalResult(c.log, "ai_provider.presets", c.presets)
}
