// cap_seo.go —— Phase B-5: seo.* tools → seo.bundle Capability。owner-only。
// 2 tools: seo.set_wiki_slug + seo.update_settings。
//
// 取代老 seo_tools.go (AddTool 调用)；同 SEOWriter 接口注入，wire 通过
// mcp.RegisterDeps 透传。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capSEOBundle = "seo.bundle"

type seoCapability struct {
	seo   SEOWriter
	stats seoStatsReader
	pins  usecases.PagePinDeps
	log   *slog.Logger
}

func newSEOCapability(
	seo SEOWriter, stats seoStatsReader, pins usecases.PagePinDeps, log *slog.Logger,
) *seoCapability {
	return &seoCapability{seo: seo, stats: stats, pins: pins, log: log}
}

func (*seoCapability) ID() string          { return capSEOBundle }
func (*seoCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*seoCapability) VisitorBinding(_ context.Context, _ *capreg.AssembleInput) (
	*capreg.Binding, error,
) {
	return nil, capreg.ErrHidden
}

func (*seoCapability) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (*seoCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *seoCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.setWikiSlugBinding(),
		c.setOutputSlugBinding(),
		c.updateSettingsBinding(),
		c.getSettingsBinding(),
		c.statsBinding(),
	}
}

// ───── seo.set_wiki_seo ──────────────────────────────────────────
// 地址纯树派生(标题 slug + parent 链),owner 不再自设 slug —— 这俩 tool 只
// 管「这条要不要公开 index + meta 描述」。

func (c *seoCapability) setWikiSlugBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "seo.set_wiki_seo",
		Description: "Set SEO description + public-indexed flag for a wiki entry " +
			"(public URL is tree-derived from the title, not owner-set).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"wiki_id":{"type":"string","description":"Wiki UUID."},
				"excerpt":{"type":"string"},
				"published":{"type":"boolean"}
			},
			"required":["wiki_id"]
		}`),
		Handler: c.handleSetWikiSlug,
	}
}

type setWikiSlugArgsWire struct {
	WikiID    string `json:"wiki_id"`
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

type setWikiSlugPayload struct {
	WikiID  string `json:"wiki_id"`
	Excerpt string `json:"excerpt"`
	// UnpinnedSections —— unpublish 一个已 pin 条目时自动摘除的主页栏目
	// (pinned ⊆ published 的 unpublish 端);副作用当面声明给 owner 的 AI。
	UnpinnedSections []string `json:"unpinned_sections"`
	Published        bool     `json:"published"`
}

func (c *seoCapability) handleSetWikiSlug(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args setWikiSlugArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.WikiID == "" {
		return capreg.MCPError("wiki_id is required")
	}
	res, err := usecases.UpdateWikiSEOWithPins(ctx, c.seo, c.pins, usecases.WikiSEOUpdate{
		OwnerID: ownerID, WikiID: args.WikiID, Description: args.Excerpt, Published: args.Published,
	})
	if err != nil {
		return seoErrToResult(c.log, err, "seo.set_wiki_seo")
	}
	return marshalSetWikiSlug(c.log, &res.Wiki, res.Unpinned)
}

func marshalSetWikiSlug(
	log *slog.Logger, w *corpusdomain.Wiki, unpinned []string,
) capreg.MCPResult {
	if unpinned == nil {
		unpinned = []string{}
	}
	payload := setWikiSlugPayload{
		WikiID:           w.ID(),
		Excerpt:          w.Excerpt(),
		Published:        w.Published(),
		UnpinnedSections: unpinned,
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.set_wiki_seo marshal", "err", err)
		return capreg.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return capreg.MCPSuccess(string(out))
}

// ───── seo.set_output_seo ────────────────────────────────────────

func (c *seoCapability) setOutputSlugBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "seo.set_output_seo",
		Description: "Set SEO description + public-indexed flag for an output entry " +
			"(public URL is tree-derived from the title, not owner-set).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"output_id":{"type":"string","description":"Output UUID."},
				"excerpt":{"type":"string"},
				"published":{"type":"boolean"}
			},
			"required":["output_id"]
		}`),
		Handler: c.handleSetOutputSlug,
	}
}

type setOutputSlugArgsWire struct {
	OutputID  string `json:"output_id"`
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

type setOutputSlugPayload struct {
	OutputID  string `json:"output_id"`
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

func (c *seoCapability) handleSetOutputSlug(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args setOutputSlugArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.OutputID == "" {
		return capreg.MCPError("output_id is required")
	}
	updated, err := c.seo.UpdateOutputSEO(ctx, ownerID, args.OutputID, args.Excerpt, args.Published)
	if err != nil {
		return seoErrToResult(c.log, err, "seo.set_output_seo")
	}
	return marshalSetOutputSlug(c.log, &updated)
}

func marshalSetOutputSlug(log *slog.Logger, o *corpusdomain.Output) capreg.MCPResult {
	payload := setOutputSlugPayload{
		OutputID:  o.ID(),
		Excerpt:   o.Excerpt(),
		Published: o.Published(),
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.set_output_seo marshal", "err", err)
		return capreg.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return capreg.MCPSuccess(string(out))
}

// ───── seo.update_settings ───────────────────────────────────────

func (c *seoCapability) updateSettingsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
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
) capreg.MCPResult {
	args, perr := parseUpdateSettingsArgs(raw)
	if perr != nil {
		return capreg.MCPError("invalid arguments: " + perr.Error())
	}
	in := &corpusdomain.SEOSettings{
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

func marshalUpdateSettings(log *slog.Logger, s *corpusdomain.SEOSettings) capreg.MCPResult {
	payload := updateSettingsPayload{
		IndexRobots:   s.IndexRobots,
		SitemapExtras: s.SitemapExtras,
		OGTemplate:    s.OGTemplate,
	}
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("seo.update_settings marshal", "err", err)
		return capreg.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return capreg.MCPSuccess(string(out))
}

// ───── shared error translation ──────────────────────────────────

func seoErrToResult(log *slog.Logger, err error, name string) capreg.MCPResult {
	if errors.Is(err, corpusdomain.ErrWikiNotFound) {
		return capreg.MCPError("wiki entry not found")
	}
	if errors.Is(err, corpusdomain.ErrOutputNotFound) {
		return capreg.MCPError("output entry not found")
	}
	log.Error(name, "err", err)
	return capreg.MCPError(name + " failed")
}
