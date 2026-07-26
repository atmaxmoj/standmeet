package ownercore

// cap_byoai.go —— owner-MCP 面 for BYOAI settings。1 tool: byoai.set
// （enabled / providers / blurb 三字段一起写，mirror admin PUT /api/admin/byoai）。
// owner-only。

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capBYOAIBundle = "byoai.bundle"

type byoaiCapability struct {
	byoai usecases.BYOAIDeps
	log   *slog.Logger
}

func newBYOAICapability(byoai usecases.BYOAIDeps, log *slog.Logger) *byoaiCapability {
	return &byoaiCapability{byoai: byoai, log: log}
}

func (*byoaiCapability) ID() string          { return capBYOAIBundle }
func (*byoaiCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*byoaiCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*byoaiCapability) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (*byoaiCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *byoaiCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.setBinding()}
}

func (c *byoaiCapability) setBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "byoai.set",
		Description: "Set BYOAI settings (enabled, allowed providers, public blurb) for " +
			"uninvited visitors who bring their own API key.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"enabled":{"type":"boolean"},
				"providers":{"type":"array","items":{"type":"string"}},
				"blurb":{"type":"string"}
			},
			"required":["enabled"]
		}`),
		Handler: c.handleSet,
	}
}

type byoaiSetArgsWire struct {
	Blurb     string   `json:"blurb"`
	Providers []string `json:"providers"`
	Enabled   bool     `json:"enabled"`
}

func parseBYOAISetArgs(raw json.RawMessage) (byoaiSetArgsWire, error) {
	var args byoaiSetArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Providers == nil {
		args.Providers = []string{}
	}
	return args, nil
}

type byoaiSetPayload struct {
	Blurb     string   `json:"blurb"`
	Providers []string `json:"providers"`
	Enabled   bool     `json:"enabled"`
}

func (c *byoaiCapability) handleSet(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseBYOAISetArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	s, err := usecases.UpdateBYOAI(ctx, c.byoai, &usecases.UpdateBYOAIInput{
		OwnerID:   ownerID,
		Blurb:     args.Blurb,
		Providers: args.Providers,
		Enabled:   args.Enabled,
	})
	if err != nil {
		if errors.Is(err, ownerdomain.ErrOwnerNotFound) {
			return capreg.MCPError("owner not found")
		}
		c.log.Error("cap byoai.set", "err", err)
		return capreg.MCPError("byoai.set failed")
	}
	return mcputil.MarshalResult(c.log, "byoai.set", byoaiPayloadFrom(&s))
}

func byoaiPayloadFrom(s *ownerdomain.OwnerSettings) byoaiSetPayload {
	providers := s.BYOAI.Providers
	if providers == nil {
		providers = []string{}
	}
	return byoaiSetPayload{
		Blurb:     s.BYOAI.PublicBlurb,
		Providers: providers,
		Enabled:   s.BYOAI.Enabled,
	}
}
