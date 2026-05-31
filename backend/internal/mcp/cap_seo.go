// cap_seo.go —— Phase B-5: seo.* tools → seo.bundle Capability。owner-only。
// 2 tools: seo.set_wiki_slug + seo.update_settings。
//
// 取代老 seo_tools.go (AddTool 调用)；同 SEOWriter 接口注入，wire 通过
// mcp.RegisterDeps 透传。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
)

const capSEOBundle = "seo.bundle"

type seoCapability struct {
	seo SEOWriter
	log *slog.Logger
}

func newSEOCapability(seo SEOWriter, log *slog.Logger) *seoCapability {
	return &seoCapability{seo: seo, log: log}
}

func (*seoCapability) ID() string               { return capSEOBundle }
func (*seoCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*seoCapability) VisitorBinding(_ context.Context, _ *agentskills.AssembleInput) (
	*agentskills.Binding, error,
) {
	return nil, agentskills.ErrHidden
}

func (*seoCapability) SystemPromptFragment(_ context.Context, _ *agentskills.AssembleInput) string {
	return ""
}

func (*seoCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *seoCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.setWikiSlugBinding(),
		c.updateSettingsBinding(),
	}
}

// ───── seo.set_wiki_slug ─────────────────────────────────────────

func (c *seoCapability) setWikiSlugBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "seo.set_wiki_slug",
		Description: "Set SEO slug / description / indexed for a wiki entry.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"Wiki UUID."},
				"seo_slug":{"type":"string","description":"URL slug (a-z0-9-)."},
				"seo_description":{"type":"string"},
				"seo_indexed":{"type":"boolean"}
			},
			"required":["wiki_id"]
		}`),
		Handler: c.handleSetWikiSlug,
	}
}

type setWikiSlugArgsWire struct {
	WikiID         string `json:"wiki_id"`
	SEOSlug        string `json:"seo_slug"`
	SEODescription string `json:"seo_description"`
	SEOIndexed     bool   `json:"seo_indexed"`
}

type setWikiSlugPayload struct {
	WikiID         string  `json:"wiki_id"`
	SEOSlug        *string `json:"seo_slug"`
	SEODescription string  `json:"seo_description"`
	SEOIndexed     bool    `json:"seo_indexed"`
}

func (c *seoCapability) handleSetWikiSlug(
	ctx context.Context, _ string, raw json.RawMessage,
) agentskills.MCPResult {
	var args setWikiSlugArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.WikiID == "" {
		return agentskills.MCPError("wiki_id is required")
	}
	updated, err := c.seo.UpdateWikiPath(
		ctx, args.WikiID, optionalSlug(args.SEOSlug),
		args.SEODescription, args.SEOIndexed,
	)
	if err != nil {
		return seoErrToResult(c.log, err, "seo.set_wiki_slug")
	}
	return marshalSetWikiSlug(c.log, &updated)
}

func marshalSetWikiSlug(log *slog.Logger, w *domain.Wiki) agentskills.MCPResult {
	var seoSlug *string
	if p, ok := w.Path(); ok {
		cp := p
		seoSlug = &cp
	}
	payload := setWikiSlugPayload{
		WikiID:         w.ID(),
		SEOSlug:        seoSlug,
		SEODescription: w.SEODescription(),
		SEOIndexed:     w.SEOIndexed(),
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.set_wiki_slug marshal", "err", err)
		return agentskills.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return agentskills.MCPSuccess(string(out))
}

func optionalSlug(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ───── seo.update_settings ───────────────────────────────────────

func (c *seoCapability) updateSettingsBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "seo.update_settings",
		Description: "Update owner-wide SEO settings (robots, sitemap_extras, og_template).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"index_robots":{"type":"boolean"},
				"sitemap_extras":{"type":"array","items":{"type":"string"}},
				"og_template":{"type":"string"}
			}
		}`),
		Handler: c.handleUpdateSettings,
	}
}

type updateSettingsArgsWire struct {
	IndexRobots   *bool    `json:"index_robots"`
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
}

type updateSettingsPayload struct {
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

func (c *seoCapability) handleUpdateSettings(
	ctx context.Context, ownerID string, raw json.RawMessage,
) agentskills.MCPResult {
	args, perr := parseUpdateSettingsArgs(raw)
	if perr != nil {
		return agentskills.MCPError("invalid arguments: " + perr.Error())
	}
	in := &domain.SEOSettings{
		OwnerID:       ownerID,
		IndexRobots:   indexRobotsOrDefault(args.IndexRobots),
		SitemapExtras: args.SitemapExtras,
		OGTemplate:    args.OGTemplate,
	}
	saved, err := c.seo.UpsertSettings(ctx, in)
	if err != nil {
		return seoErrToResult(c.log, err, "seo.update_settings")
	}
	return marshalUpdateSettings(c.log, &saved)
}

func parseUpdateSettingsArgs(raw json.RawMessage) (updateSettingsArgsWire, error) {
	var args updateSettingsArgsWire
	if len(raw) == 0 || string(raw) == "{}" {
		return args, nil
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, fmt.Errorf("unmarshal: %w", err)
	}
	if args.SitemapExtras == nil {
		args.SitemapExtras = []string{}
	}
	return args, nil
}

func indexRobotsOrDefault(p *bool) bool {
	if p == nil {
		return true
	}
	return *p
}

func marshalUpdateSettings(log *slog.Logger, s *domain.SEOSettings) agentskills.MCPResult {
	payload := updateSettingsPayload{
		IndexRobots:   s.IndexRobots,
		SitemapExtras: s.SitemapExtras,
		OGTemplate:    s.OGTemplate,
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.update_settings marshal", "err", err)
		return agentskills.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return agentskills.MCPSuccess(string(out))
}

// ───── shared error translation ──────────────────────────────────

func seoErrToResult(log *slog.Logger, err error, name string) agentskills.MCPResult {
	if errors.Is(err, domain.ErrPathTaken) {
		return agentskills.MCPError("path already taken")
	}
	if errors.Is(err, domain.ErrWikiNotFound) {
		return agentskills.MCPError("wiki entry not found")
	}
	log.Error(name, "err", err)
	return agentskills.MCPError(name + " failed")
}
