// seo.go —— 资源 seo:这台实例被搜索引擎和分享卡片看见的那一面。
//
// 三件事:owner 全站的设置(站点标题 / robots / sitemap 补充 / og 模板)、各 genre 已公开
// 条目的计数、以及**一条条目**的公开开关和摘要。
//
// 为什么住在 owner 而不是 corpus:公开一条 wiki 的另一半是主页 —— 取消公开要把 pin 着它
// 的栏目一起摘掉(pinned ⊆ published),那是 owner 的页面。跨域的资源由**能 import 另一边**
// 的那个域声明(owner → corpus 是既有方向),这样不必再造一个端口加一段组装根的搬运。
//
// 归一化时收掉的三处:
//
//   - seo.update_settings 从 MCP 打过来会**洗掉 site_title**:那条 upsert 是整行覆写,
//     而 MCP 那份入参里根本没有 site_title。三态入参 + 域里的合并之后每个面同一条规则。
//   - 面板早就把 wiki / output 收成了一条路由(genre 走路径),MCP 那边还是两个 tool。
//     同一件事,只是条目属于哪个 genre —— 一个 op,genre 是参数。
//   - 出站载荷里条目的主键,面板叫 id、MCP 叫 wiki_id/output_id。一份载荷,叫 id。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// 条目的两个 genre —— 每个面用同一套词。
const (
	seoGenreWiki   = "wiki"
	seoGenreOutput = "output"
)

// SEODeps —— 设置/计数/条目在 corpus,取消公开时摘 pin 在本域。
//
// Corpus 只为一件事：发布/取消发布**改的是那条笔记**，所以写完要把它的检索索引刷新。
// 索引里的 `published` 是 public 身份的准入判据(F-D-7)，一份不刷新的索引会让刚发布的
// 笔记从检索里消失、刚取消发布的笔记继续被搜到。
type SEODeps struct {
	SEO    *corpus.SEORepo
	Pins   usecase.PagePinDeps
	Corpus corpus.Deps
}

// SEO —— get_settings / update_settings / stats / set_entry_seo。
//
// 收 *SEODeps：这份 deps 现在带着 corpus.Deps（发布要刷索引），按值传会被 gocritic 判 hugeParam。
func SEO(d *SEODeps) []fp.Op {
	return []fp.Op{
		{
			ID: "seo.get_settings",
			Description: "Read the owner-wide public-facing settings: site title, robots " +
				"indexing switch, extra sitemap URLs and the OG title template.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getSEOSettings(d.SEO),
		},
		{
			ID: "seo.update_settings",
			Description: "Change owner-wide public-facing settings. Omitted fields keep " +
				"their current value.",
			InputSchema: seoSettingsSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateSEOSettings(d.SEO),
		},
		{
			ID:          "seo.stats",
			Description: "Count the published entries per genre (wiki, outputs, writings).",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      seoStats(d.SEO),
		},
		{
			ID: "seo.set_entry_seo",
			Description: "Publish or unpublish one corpus entry and set its excerpt. The " +
				"public URL is derived from the title and the tree, never set by hand. " +
				"Unpublishing a pinned wiki entry also unpins it, and says which sections.",
			InputSchema: seoEntrySchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setEntrySEO(d),
		},
	}
}

var (
	seoSettingsSchema = json.RawMessage(`{
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

	seoEntrySchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string","description":"wiki | output."},
			"id":{"type":"string","description":"Corpus entry id."},
			"excerpt":{"type":"string","description":"Meta description / card summary."},
			"published":{"type":"boolean","description":"Whether it is publicly readable."}
		},
		"required":["genre","id"]
	}`)
)

// seoSettingsOut / seoStatsOut / seoEntryOut —— 出站载荷(每个面同一份)。
type seoSettingsOut struct {
	SiteTitle     string   `json:"site_title"`
	OGTemplate    string   `json:"og_template"`
	SitemapExtras []string `json:"sitemap_extras"`
	IndexRobots   bool     `json:"index_robots"`
}

type seoStatsOut struct {
	Wiki     int64 `json:"wiki"`
	Outputs  int64 `json:"outputs"`
	Writings int64 `json:"writings"`
}

type seoEntryOut struct {
	ID      string `json:"id"`
	Genre   string `json:"genre"`
	Excerpt string `json:"excerpt"`
	// UnpinnedSections —— 取消公开时自动摘掉的主页栏目(空 = 本来就没 pin)。
	UnpinnedSections []string `json:"unpinned_sections"`
	Published        bool     `json:"published"`
}

func toSEOSettingsOut(s *corpus.SEOSettings) seoSettingsOut {
	return seoSettingsOut{
		SiteTitle: s.SiteTitle, OGTemplate: s.OGTemplate,
		SitemapExtras: nonNilStrings(s.SitemapExtras), IndexRobots: s.IndexRobots,
	}
}

func getSEOSettings(seo *corpus.SEORepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		s, err := seo.GetSettings(ctx, ownerID)
		if err != nil {
			return nil, seoErr(err)
		}
		return json.Marshal(toSEOSettingsOut(&s))
	}
}

type seoSettingsArgs struct {
	SiteTitle     fp.OptionalString  `json:"site_title"`
	OGTemplate    fp.OptionalString  `json:"og_template"`
	SitemapExtras fp.OptionalStrings `json:"sitemap_extras"`
	IndexRobots   fp.OptionalBool    `json:"index_robots"`
}

func updateSEOSettings(seo *corpus.SEORepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSEOSettings(raw)
		if perr != nil {
			return nil, perr
		}
		saved, err := corpus.PatchSEOSettings(ctx, seo, &corpus.SEOSettingsPatch{
			OwnerID:       ownerID,
			SiteTitle:     corpus.OptionalText{Value: in.SiteTitle.Value, Set: in.SiteTitle.Set},
			OGTemplate:    corpus.OptionalText{Value: in.OGTemplate.Value, Set: in.OGTemplate.Set},
			SitemapExtras: corpus.OptionalTextList(in.SitemapExtras),
			IndexRobots:   corpus.OptionalFlag(in.IndexRobots),
		})
		if err != nil {
			return nil, seoErr(err)
		}
		return json.Marshal(toSEOSettingsOut(&saved))
	}
}

// decodeSEOSettings —— 字段全可选:空 body = 什么都不改。
func decodeSEOSettings(raw json.RawMessage) (seoSettingsArgs, error) {
	var in seoSettingsArgs
	if len(raw) == 0 {
		return in, nil
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func seoStats(seo *corpus.SEORepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		counts, err := seo.CountPublished(ctx, ownerID)
		if err != nil {
			return nil, seoErr(err)
		}
		return json.Marshal(seoStatsOut{
			Wiki: counts.Wiki, Outputs: counts.Outputs, Writings: counts.Writings,
		})
	}
}

type seoEntryArgs struct {
	Genre     string `json:"genre"`
	ID        string `json:"id"`
	Excerpt   string `json:"excerpt"`
	Published bool   `json:"published"`
}

// setEntrySEO —— genre 决定走哪条:wiki 要连着摘 pin,output 不上主页。
func setEntrySEO(d *SEODeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSEOEntry(raw)
		if perr != nil {
			return nil, perr
		}
		if in.Genre == seoGenreWiki {
			return setWikiSEO(ctx, d, ownerID, in)
		}
		return setOutputSEO(ctx, d, ownerID, in)
	}
}

func decodeSEOEntry(raw json.RawMessage) (seoEntryArgs, error) {
	var in seoEntryArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
		return in, err
	}
	if in.Genre != seoGenreWiki && in.Genre != seoGenreOutput {
		return in, fp.BadInput("genre must be wiki or output")
	}
	return in, nil
}

func setWikiSEO(
	ctx context.Context, d *SEODeps, ownerID string, in seoEntryArgs,
) (json.RawMessage, error) {
	res, err := usecase.UpdateWikiSEOWithPins(ctx, d.SEO, d.Pins, usecase.WikiSEOUpdate{
		OwnerID: ownerID, WikiID: in.ID,
		Description: in.Excerpt, Published: in.Published,
	})
	if err != nil {
		return nil, seoErr(err)
	}
	// 发布状态变了 → 这条笔记的检索文档要跟着变（见 SEODeps.Corpus）。
	corpus.ReindexCorpusNote(ctx, d.Corpus, ownerID, in.ID)
	return json.Marshal(seoEntryOut{
		ID: res.Wiki.ID(), Genre: in.Genre, Excerpt: res.Wiki.Excerpt(),
		Published: res.Wiki.Published(), UnpinnedSections: nonNilStrings(res.Unpinned),
	})
}

func setOutputSEO(
	ctx context.Context, d *SEODeps, ownerID string, in seoEntryArgs,
) (json.RawMessage, error) {
	updated, err := d.SEO.UpdateOutputSEO(ctx, ownerID, in.ID, in.Excerpt, in.Published)
	if err != nil {
		return nil, seoErr(err)
	}
	corpus.ReindexCorpusNote(ctx, d.Corpus, ownerID, in.ID)
	return json.Marshal(seoEntryOut{
		ID: updated.ID(), Genre: in.Genre, Excerpt: updated.Excerpt(),
		Published: updated.Published(), UnpinnedSections: []string{},
	})
}

// seoErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func seoErr(err error) error {
	for _, c := range seoErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("seo op", err)
}

var seoErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{corpus.ErrWikiNotFound, func() error {
		return fp.Coded(fp.NotFound("wiki entry not found"), "wiki_not_found")
	}},
	{corpus.ErrOutputNotFound, func() error {
		return fp.Coded(fp.NotFound("output entry not found"), "output_not_found")
	}},
}
