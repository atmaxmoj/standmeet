package ownercore

// cap_marketplace.go —— owner-side skill-marketplace Capability. 2 tools:
// marketplace.search (read) / marketplace.install (action). owner-only.
// Mirrors the admin /api/admin/marketplace routes over MCP so the owner can
// browse + install skills from Claude Code. search delegates to
// usecases.SearchMarketplace; install to usecases.InstallSkill (fetch the
// SKILL.md, persist it as a source='marketplace' skill).

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capMarketplaceBundle = "marketplace.bundle"

// marketSearchDefaultLimit —— one page of results per search call.
const marketSearchDefaultLimit = 24

// marketplaceCapability —— deps is usecases.InstallSkillDeps: it carries both the
// marketplace client (search + SKILL.md fetch) and the skill repo (install
// persistence), so one value serves both tools.
type marketplaceCapability struct {
	deps usecases.InstallSkillDeps
	log  *slog.Logger
}

func newMarketplaceCapability(
	deps usecases.InstallSkillDeps, log *slog.Logger,
) *marketplaceCapability {
	return &marketplaceCapability{deps: deps, log: log}
}

func (*marketplaceCapability) ID() string          { return capMarketplaceBundle }
func (*marketplaceCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*marketplaceCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*marketplaceCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*marketplaceCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *marketplaceCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.searchBinding(), c.installBinding()}
}

// ───── marketplace.search ───────────────────────────────────────

func (c *marketplaceCapability) searchBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "marketplace.search",
		Description: "Search the skill marketplace (GitHub + SkillsMP directory). " +
			"Returns up to 24 matching skills with their source, id, name, version, " +
			"and description. Read-only.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"query":{"type":"string","description":"Free-text search query."},
				"source":{"type":"string",
					"description":"Optional filter: 'github' | 'skillsmp' (default all)."}
			}
		}`),
		Handler: c.handleSearch,
	}
}

type marketSearchArgsWire struct {
	Query  string `json:"query"`
	Source string `json:"source"`
}

func parseMarketSearchArgs(raw json.RawMessage) (marketSearchArgsWire, error) {
	var args marketSearchArgsWire
	if len(raw) == 0 {
		return args, nil
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	return args, nil
}

func (c *marketplaceCapability) handleSearch(
	ctx context.Context, _ string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseMarketSearchArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	items := usecases.SearchMarketplace(ctx,
		usecases.MarketplaceDeps{Client: c.deps.Marketplace},
		usecases.MarketSearchParams{
			Query: args.Query, Source: args.Source, Limit: marketSearchDefaultLimit,
		})
	return mcputil.MarshalResult(c.log, "marketplace.search", items)
}

// ───── marketplace.install ──────────────────────────────────────

func (c *marketplaceCapability) installBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "marketplace.install",
		Description: "Install a marketplace skill by source + id: fetch its SKILL.md " +
			"and persist it as a source='marketplace' owner skill. name/version are " +
			"fallback metadata when the frontmatter omits them.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"source":{"type":"string","description":"'github' | 'skillsmp'."},
				"id":{"type":"string",
					"description":"Market skill id (github dir name / skillsmp id)."},
				"name":{"type":"string","description":"Fallback display name."},
				"version":{"type":"string","description":"Optional version tag."}
			},
			"required":["source","id"]
		}`),
		Handler: c.handleInstall,
	}
}

type marketInstallArgsWire struct {
	Source  string `json:"source"`
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
}

func parseMarketInstallArgs(raw json.RawMessage) (marketInstallArgsWire, error) {
	var args marketInstallArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Source == "" || args.ID == "" {
		return args, errors.New("source and id are required")
	}
	return args, nil
}

func (c *marketplaceCapability) handleInstall(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseMarketInstallArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	skill, err := usecases.InstallSkill(ctx, c.deps, &usecases.InstallSkillInput{
		OwnerID: ownerID, Source: args.Source, ID: args.ID,
		Name: args.Name, Version: args.Version,
	})
	if err != nil {
		return marketInstallErr(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "marketplace.install", map[string]any{
		"id": skill.ID, "name": skill.Name, "installed": true,
	})
}

func marketInstallErr(log *slog.Logger, err error) capreg.MCPResult {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		return capreg.MCPError("source, id, and a non-empty SKILL.md are required")
	case errors.Is(err, domain.ErrSkillNameTaken):
		return capreg.MCPError("a skill with that name is already installed")
	}
	log.Error("cap marketplace.install", "err", err)
	return capreg.MCPError("could not fetch or parse the skill — check the source")
}
