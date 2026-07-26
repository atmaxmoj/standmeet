package ownercore

// cap_seo_more.go —— seo.bundle 的只读 companion tools: seo.get_settings + seo.stats。
// 写侧 (set_wiki_seo / set_output_seo / update_settings) 在 cap_seo.go；读侧拆到这里，
// 让 cap_seo.go 保持在 350 行以下。方法都挂在同一个 *seoCapability 上。

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
)

// seoStatsReader —— seo.stats 需要的最小接口。返回中性计数（避开 postgres.PublishedCounts）。
type seoStatsReader interface {
	CountPublished(ctx context.Context, ownerID string) (SEOStats, error)
}

// SEOStats —— 各 tier 已公开条目数（seo.stats 的 wire 形状）。
type SEOStats struct {
	Wiki     int64 `json:"wiki"`
	Outputs  int64 `json:"outputs"`
	Writings int64 `json:"writings"`
}

// ───── seo.get_settings ──────────────────────────────────────────

func (c *seoCapability) getSettingsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "seo.get_settings",
		Description: "Return owner-wide SEO settings (site_title, index_robots, " +
			"sitemap_extras, og_template).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleGetSettings,
	}
}

type seoSettingsPayload struct {
	SiteTitle     string   `json:"site_title"`
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

func (c *seoCapability) handleGetSettings(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	s, err := c.seo.GetSettings(ctx, ownerID)
	if err != nil {
		c.log.Error("seo.get_settings", "err", err)
		return capreg.MCPError("seo.get_settings failed")
	}
	return mcputil.MarshalResult(c.log, "seo.get_settings", seoSettingsPayloadFrom(&s))
}

func seoSettingsPayloadFrom(s *corpusdomain.SEOSettings) seoSettingsPayload {
	extras := s.SitemapExtras
	if extras == nil {
		extras = []string{}
	}
	return seoSettingsPayload{
		SiteTitle:     s.SiteTitle,
		OGTemplate:    s.OGTemplate,
		SitemapExtras: extras,
		IndexRobots:   s.IndexRobots,
	}
}

// ───── seo.stats ─────────────────────────────────────────────────

func (c *seoCapability) statsBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "seo.stats",
		Description: "Return published-entry counts per tier (wiki, outputs, writings).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleStats,
	}
}

func (c *seoCapability) handleStats(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	counts, err := c.stats.CountPublished(ctx, ownerID)
	if err != nil {
		c.log.Error("seo.stats", "err", err)
		return capreg.MCPError("seo.stats failed")
	}
	return mcputil.MarshalResult(c.log, "seo.stats", counts)
}
