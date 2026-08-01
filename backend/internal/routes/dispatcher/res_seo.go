// res_seo.go —— 资源 seo:这台实例被搜索引擎和分享卡片看见的那一面。
//
// 三件事:owner 全站的设置(站点标题 / robots / sitemap 补充 / og 模板)、各 genre 已公开
// 条目的计数、以及**一条条目**的公开开关和摘要。
//
// 迁移时发现的三处:
//
//   - seo.update_settings 从 MCP 打过来会**洗掉 site_title**:那条 upsert 是整行覆写,
//     而 MCP 那份入参里根本没有 site_title,于是每次从 Claude Code 改一下 robots,
//     owner 自己写的站点标题就没了。三态入参(见 optional.go)之后两个面同一条规则。
//   - 面板早就把 wiki / output 收成了一条路由(genre 走路径),MCP 那边还是两个 tool。
//     同一件事,只是条目属于哪个 genre —— 收成一个 op,genre 是参数。
//   - 出站载荷里条目的主键,面板叫 id、MCP 叫 wiki_id/output_id。一份载荷,叫 id。

package dispatcher

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// SEOSettings —— owner 全站的对外设置。
type SEOSettings struct {
	SiteTitle     string
	OGTemplate    string
	SitemapExtras []string
	IndexRobots   bool
}

// UpdateSEOSettings —— 改设置。每个字段三态:没提到 = 保持原值。
type UpdateSEOSettings struct {
	OwnerID       string
	SiteTitle     OptionalString
	OGTemplate    OptionalString
	SitemapExtras OptionalStrings
	IndexRobots   OptionalBool
}

// SEOStats —— 各 genre 已公开的条目数。
type SEOStats struct {
	Wiki     int64
	Outputs  int64
	Writings int64
}

// 条目的两个 genre —— 面板和 MCP 用同一套词。
const (
	SEOGenreWiki   = "wiki"
	SEOGenreOutput = "output"
)

// SEOStore —— seo 这组操作所需的最小口。
type SEOStore interface {
	Settings(ctx context.Context, ownerID string) (SEOSettings, error)
	SaveSettings(ctx context.Context, in *UpdateSEOSettings) (SEOSettings, error)
	Stats(ctx context.Context, ownerID string) (SEOStats, error)
	SetEntrySEO(ctx context.Context, in *EntrySEO) (EntrySEOResult, error)
}

// SEO —— seo 资源。
func SEO(store SEOStore) Resource {
	return Resource{Name: "seo", Ops: []Op{
		{
			ID: "seo.get_settings",
			Description: "Read the owner-wide public-facing settings: site title, robots " +
				"indexing switch, extra sitemap URLs and the OG title template.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      seoGetSettings(store),
		},
		{
			ID: "seo.update_settings",
			Description: "Change owner-wide public-facing settings. Omitted fields keep " +
				"their current value.",
			InputSchema: seoSettingsSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      seoUpdateSettings(store),
		},
		{
			ID:          "seo.stats",
			Description: "Count the published entries per genre (wiki, outputs, writings).",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      seoStats(store),
		},
		{
			ID: "seo.set_entry_seo",
			Description: "Publish or unpublish one corpus entry and set its excerpt. The " +
				"public URL is derived from the title and the tree, never set by hand. " +
				"Unpublishing a pinned wiki entry also unpins it, and says which sections.",
			InputSchema: seoEntrySchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      seoSetEntry(store),
		},
	}}
}

var seoSettingsSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"site_title":{"type":"string","description":"Owner-written site title."},
		"index_robots":{"type":"boolean",
			"description":"Whether robots may index this instance."},
		"sitemap_extras":{"type":"array","items":{"type":"string"},
			"description":"Extra URLs to list in the sitemap."},
		"og_template":{"type":"string","description":"OG title template."}
	}
}`)

var seoEntrySchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"wiki | output."},
		"id":{"type":"string","description":"Corpus entry id."},
		"excerpt":{"type":"string","description":"Meta description / card summary."},
		"published":{"type":"boolean","description":"Whether it is publicly readable."}
	},
	"required":["genre","id"]
}`)
