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

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
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
		c.setOutputSlugBinding(),
		c.updateSettingsBinding(),
	}
}

// ───── seo.set_wiki_seo ──────────────────────────────────────────
// 地址纯树派生(标题 slug + parent 链),owner 不再自设 slug —— 这俩 tool 只
// 管「这条要不要公开 index + meta 描述」。

func (c *seoCapability) setWikiSlugBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "seo.set_wiki_seo",
		Description: "Set SEO description + public-indexed flag for a wiki entry " +
			"(public URL is tree-derived from the title, not owner-set).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"Wiki UUID."},
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
	SEODescription string `json:"seo_description"`
	SEOIndexed     bool   `json:"seo_indexed"`
}

type setWikiSlugPayload struct {
	WikiID         string `json:"wiki_id"`
	SEODescription string `json:"seo_description"`
	SEOIndexed     bool   `json:"seo_indexed"`
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
	updated, err := c.seo.UpdateWikiSEO(ctx, args.WikiID, args.SEODescription, args.SEOIndexed)
	if err != nil {
		return seoErrToResult(c.log, err, "seo.set_wiki_seo")
	}
	return marshalSetWikiSlug(c.log, &updated)
}

func marshalSetWikiSlug(log *slog.Logger, w *domain.Wiki) agentskills.MCPResult {
	payload := setWikiSlugPayload{
		WikiID:         w.ID(),
		SEODescription: w.SEODescription(),
		SEOIndexed:     w.SEOIndexed(),
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.set_wiki_seo marshal", "err", err)
		return agentskills.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return agentskills.MCPSuccess(string(out))
}

// ───── seo.set_output_seo ────────────────────────────────────────

func (c *seoCapability) setOutputSlugBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name: "seo.set_output_seo",
		Description: "Set SEO description + public-indexed flag for an output entry " +
			"(public URL is tree-derived from the title, not owner-set).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"output_id":{"type":"string","description":"Output UUID."},
				"seo_description":{"type":"string"},
				"seo_indexed":{"type":"boolean"}
			},
			"required":["output_id"]
		}`),
		Handler: c.handleSetOutputSlug,
	}
}

type setOutputSlugArgsWire struct {
	OutputID       string `json:"output_id"`
	SEODescription string `json:"seo_description"`
	SEOIndexed     bool   `json:"seo_indexed"`
}

type setOutputSlugPayload struct {
	OutputID       string `json:"output_id"`
	SEODescription string `json:"seo_description"`
	SEOIndexed     bool   `json:"seo_indexed"`
}

func (c *seoCapability) handleSetOutputSlug(
	ctx context.Context, _ string, raw json.RawMessage,
) agentskills.MCPResult {
	var args setOutputSlugArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.OutputID == "" {
		return agentskills.MCPError("output_id is required")
	}
	updated, err := c.seo.UpdateOutputSEO(ctx, args.OutputID, args.SEODescription, args.SEOIndexed)
	if err != nil {
		return seoErrToResult(c.log, err, "seo.set_output_seo")
	}
	return marshalSetOutputSlug(c.log, &updated)
}

func marshalSetOutputSlug(log *slog.Logger, o *domain.Output) agentskills.MCPResult {
	payload := setOutputSlugPayload{
		OutputID:       o.ID(),
		SEODescription: o.SEODescription(),
		SEOIndexed:     o.SEOIndexed(),
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.set_output_seo marshal", "err", err)
		return agentskills.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return agentskills.MCPSuccess(string(out))
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
	if errors.Is(err, domain.ErrWikiNotFound) {
		return agentskills.MCPError("wiki entry not found")
	}
	if errors.Is(err, domain.ErrOutputNotFound) {
		return agentskills.MCPError("output entry not found")
	}
	log.Error(name, "err", err)
	return agentskills.MCPError(name + " failed")
}
