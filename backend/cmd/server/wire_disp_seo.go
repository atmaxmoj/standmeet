// wire_disp_seo.go —— corpus 域的对外可见面 → 出站收口的窄口。
//
// 两处是这里做的、收口不该知道的:
//
//   - 设置那条 upsert 是**整行覆写**,所以没提到的字段要先读回当前值填上。以前只有面板
//     每次发全量才没事;MCP 那条路径不发 site_title,于是每改一次 robots 就把 owner 写的
//     站点标题洗成空。三态入参 + 这里的合并之后,两个面同一条规则。
//   - wiki 取消公开要顺带把主页上 pin 着它的栏目摘掉(pinned ⊆ published)。output 不上
//     主页,没有这一步。收口只看见"设一条条目的公开状态",分派在这儿。

package main

import (
	"context"
	"errors"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type seoOps struct {
	seo  *corpus.SEORepo
	pins owner.PagePinDeps
}

func newSEOOps(d *runtimeDeps) seoOps {
	return seoOps{
		seo:  d.seoRepo,
		pins: owner.PagePinDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
	}
}

func (a seoOps) Settings(
	ctx context.Context, ownerID string,
) (dispatcher.SEOSettings, error) {
	s, err := a.seo.GetSettings(ctx, ownerID)
	if err != nil {
		return dispatcher.SEOSettings{}, seoErr(err)
	}
	return toDispatcherSEOSettings(&s), nil
}

func (a seoOps) SaveSettings(
	ctx context.Context, in *dispatcher.UpdateSEOSettings,
) (dispatcher.SEOSettings, error) {
	saved, err := corpus.PatchSEOSettings(ctx, a.seo, &corpus.SEOSettingsPatch{
		OwnerID:       in.OwnerID,
		SiteTitle:     corpus.OptionalText{Value: in.SiteTitle.Value, Set: in.SiteTitle.Set},
		OGTemplate:    corpus.OptionalText{Value: in.OGTemplate.Value, Set: in.OGTemplate.Set},
		SitemapExtras: corpus.OptionalTextList(in.SitemapExtras),
		IndexRobots:   corpus.OptionalFlag(in.IndexRobots),
	})
	if err != nil {
		return dispatcher.SEOSettings{}, seoErr(err)
	}
	return toDispatcherSEOSettings(&saved), nil
}

func (a seoOps) Stats(ctx context.Context, ownerID string) (dispatcher.SEOStats, error) {
	counts, err := a.seo.CountPublished(ctx, ownerID)
	if err != nil {
		return dispatcher.SEOStats{}, seoErr(err)
	}
	return dispatcher.SEOStats{
		Wiki: counts.Wiki, Outputs: counts.Outputs, Writings: counts.Writings,
	}, nil
}

// SetEntrySEO —— genre 决定走哪条:wiki 要连着摘 pin,output 不上主页。
func (a seoOps) SetEntrySEO(
	ctx context.Context, in *dispatcher.EntrySEO,
) (dispatcher.EntrySEOResult, error) {
	if in.Genre == dispatcher.SEOGenreWiki {
		return a.setWikiSEO(ctx, in)
	}
	updated, err := a.seo.UpdateOutputSEO(ctx, in.OwnerID, in.EntryID, in.Excerpt, in.Published)
	if err != nil {
		return dispatcher.EntrySEOResult{}, seoErr(err)
	}
	return dispatcher.EntrySEOResult{
		ID: updated.ID(), Genre: in.Genre, Excerpt: updated.Excerpt(),
		Published: updated.Published(), Unpinned: []string{},
	}, nil
}

func (a seoOps) setWikiSEO(
	ctx context.Context, in *dispatcher.EntrySEO,
) (dispatcher.EntrySEOResult, error) {
	res, err := owner.UpdateWikiSEOWithPins(ctx, a.seo, a.pins, owner.WikiSEOUpdate{
		OwnerID: in.OwnerID, WikiID: in.EntryID,
		Description: in.Excerpt, Published: in.Published,
	})
	if err != nil {
		return dispatcher.EntrySEOResult{}, seoErr(err)
	}
	return dispatcher.EntrySEOResult{
		ID: res.Wiki.ID(), Genre: in.Genre, Excerpt: res.Wiki.Excerpt(),
		Published: res.Wiki.Published(), Unpinned: res.Unpinned,
	}, nil
}

func toDispatcherSEOSettings(s *corpus.SEOSettings) dispatcher.SEOSettings {
	return dispatcher.SEOSettings{
		SiteTitle: s.SiteTitle, OGTemplate: s.OGTemplate,
		SitemapExtras: s.SitemapExtras, IndexRobots: s.IndexRobots,
	}
}

func seoErr(err error) error {
	if err == nil {
		return nil
	}
	for _, c := range seoErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fmt.Errorf("seo op: %w", err)
}

var seoErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{corpus.ErrWikiNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("wiki entry not found"), "wiki_not_found")
	}},
	{corpus.ErrOutputNotFound, func() error {
		return dispatcher.Coded(dispatcher.NotFound("output entry not found"), "output_not_found")
	}},
}

// 编译期确认:适配器满足收口声明的那个窄口。
var _ dispatcher.SEOStore = seoOps{}
