// cap_appearance.go —— owner-only capability。1 tool: set_owner_css(owner 的 AI 设自定义 CSS,
// 存前 sanitize+scope)。pattern 同 cap_subjectivity.go。

package ownercore

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

const capAppearanceBundle = "appearance.bundle"

type appearanceCapability struct {
	store owner.CSSStore
	log   *slog.Logger
}

func newAppearanceCapability(
	store owner.CSSStore, log *slog.Logger,
) *appearanceCapability {
	return &appearanceCapability{store: store, log: log}
}

func (*appearanceCapability) ID() string          { return capAppearanceBundle }
func (*appearanceCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }

func (*appearanceCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*appearanceCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*appearanceCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *appearanceCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		{
			Name: "set_owner_css",
			Description: "Set the owner's custom CSS for their public corpus pages (like an " +
				"Obsidian CSS snippet). Sanitized + scoped to the content area on save.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"css":{"type":"string","description":"Raw CSS"}},
				"required":["css"]
			}`),
			Handler: c.handleSetOwnerCSS,
		},
		c.getCSSBinding(),
	}
}

func (c *appearanceCapability) getCSSBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "appearance.get_css",
		Description: "Return the owner's current custom CSS (the sanitized + scoped version " +
			"stored on save).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleGetCSS,
	}
}

func (c *appearanceCapability) handleGetCSS(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	css, err := c.store.GetCSS(ctx, ownerID)
	if err != nil {
		c.log.Error("appearance.get_css", "err", err)
		return capreg.MCPError("appearance.get_css failed")
	}
	return mcputil.MarshalResult(c.log, "appearance.get_css", map[string]string{"css": css})
}

func (c *appearanceCapability) handleSetOwnerCSS(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args struct {
		CSS string `json:"css"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if err := owner.SetOwnerCSS(ctx, c.store, ownerID, args.CSS); err != nil {
		return capreg.MCPError(err.Error())
	}
	return mcputil.MarshalResult(c.log, "set_owner_css", map[string]string{"status": "ok"})
}
