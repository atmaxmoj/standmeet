// page_pins_seo.go —— publish 开关和 pin 不变量的会合点。
//
// pinned ⊆ published 的 unpublish 端:改 wiki published 的两个入口(admin PATCH
// /corpus/wiki/{id}/seo 和 MCP seo.set_wiki_seo)都必须走 UpdateWikiSEOWithPins,
// 不直接调 repo —— unpublish 一个已 pin 条目会成功 + 自动 unpin,并把被摘栏目
// 返给 caller 写进响应/tool result(副作用当面声明,不藏)。
//
// vault sync 是第三条 published 写路径(frontmatter 可翻 publish),它批量 reconcile
// 后调 SweepPagePins 清掉失效 pin;渲染侧 published 过滤仍是兜底(防御纵深)。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpusdomain"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// WikiSEOUpdater —— repo 面的窄口(postgres.SEORepo 满足)。
type WikiSEOUpdater interface {
	UpdateWikiSEO(
		ctx context.Context, ownerID, wikiID, description string, indexed bool,
	) (corpusdomain.Wiki, error)
}

// WikiSEOUpdate —— 一次 wiki SEO 更新的入参(excerpt + publish 开关)。
type WikiSEOUpdate struct {
	OwnerID     string
	WikiID      string
	Description string
	Published   bool
}

// WikiSEOResult —— 更新后的 wiki + 因 unpublish 被自动摘除的栏目名。
type WikiSEOResult struct {
	Unpinned []string
	Wiki     corpusdomain.Wiki
}

// UpdateWikiSEOWithPins —— 改 excerpt/published,unpublish 时自动 unpin。
// 返回更新后的 wiki + 被摘的栏目名。
func UpdateWikiSEOWithPins(
	ctx context.Context, seo WikiSEOUpdater, pins PagePinDeps, upd WikiSEOUpdate,
) (WikiSEOResult, error) {
	updated, err := seo.UpdateWikiSEO(ctx, upd.OwnerID, upd.WikiID, upd.Description, upd.Published)
	if err != nil {
		return WikiSEOResult{}, fmt.Errorf("update wiki seo: %w", err)
	}
	if upd.Published {
		return WikiSEOResult{Wiki: updated, Unpinned: []string{}}, nil
	}
	unpinned, uerr := UnpinWikiEverywhere(ctx, pins, upd.OwnerID, upd.WikiID)
	if uerr != nil {
		return WikiSEOResult{}, fmt.Errorf("auto-unpin on unpublish: %w", uerr)
	}
	return WikiSEOResult{Wiki: updated, Unpinned: unpinned}, nil
}

// SweepPagePins —— 批量写路径(vault sync)后的清扫:摘掉已删/已 unpublish 的
// pin。逐条路过同一套 mutate,不另起第二套实现。
func SweepPagePins(ctx context.Context, pins PagePinDeps, ownerID string) error {
	content, err := loadPageContentOrDefault(ctx, PageDeps{Owners: pins.Owners}, ownerID)
	if err != nil {
		return err
	}
	join, err := LoadPinJoin(ctx, pins, ownerID, &content)
	if err != nil {
		return err
	}
	for _, id := range collectStalePins(&content, join.Cards) {
		if _, uerr := UnpinWikiEverywhere(ctx, pins, ownerID, id); uerr != nil {
			return uerr
		}
	}
	return nil
}

// collectStalePins —— 不再 published(或条目已删,join 未命中)的 pin id 集。
func collectStalePins(
	content *ownerdomain.PageContent, cards map[string]postgres.WikiCard,
) []string {
	stale := []string{}
	for _, id := range append(append([]string{}, content.Insights...), content.Projects...) {
		card, ok := cards[id]
		if !ok || !card.Published {
			stale = append(stale, id)
		}
	}
	return stale
}
