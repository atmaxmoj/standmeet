// page_pins.go —— 主页 pin 列表(insights/projects = corpus 窗口)的**唯一**
// 维护点(docs/design/page-corpus-pinning.md)。
//
// 不变量 pinned ⊆ published,两端写入时维护,全部路过这里:
//   • PinToPage / ValidatePagePins —— pin(MCP page.pin / admin PUT)拒未发布
//   • UnpinWikiEverywhere —— unpublish / delete 钩子:自动摘除 + 返回被摘的
//     栏目名(caller 在 tool result 里声明副作用)
// 渲染侧 ResolvePinCards 只按 published 兜底过滤(防御纵深,不是主机制)。

package usecase

import (
	"context"
	"fmt"
	"slices"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PagePinDeps —— pin 维护点依赖:page_content 存取 + wiki 卡内容/树路径。
type PagePinDeps struct {
	Owners *repo.Repo
	Wiki   *corpus.WikiRepo
}

// PinSectionInsights / PinSectionProjects —— 可 pin 的两个栏目。
const (
	PinSectionInsights = "insights"
	PinSectionProjects = "projects"
)

// PinToPage —— 把 published 的 wiki 条目 pin 进栏目(已 pin 则幂等)。
// 返回该栏目的最新 pin 列表。未发布 → ErrPinUnpublished;不存在 →
// ErrPinNotFound;栏目名非法 → error。
func PinToPage(
	ctx context.Context, deps PagePinDeps, ownerID, section, wikiID string,
) ([]string, error) {
	if err := checkPinnable(ctx, deps, ownerID, wikiID); err != nil {
		return nil, err
	}
	return mutatePins(ctx, deps, ownerID, section, func(pins []string) []string {
		return appendPinOnce(pins, wikiID)
	})
}

// UnpinFromPage —— 从栏目摘除一个 pin(不在列表则幂等)。返回最新列表。
func UnpinFromPage(
	ctx context.Context, deps PagePinDeps, ownerID, section, wikiID string,
) ([]string, error) {
	return mutatePins(ctx, deps, ownerID, section, func(pins []string) []string {
		return removePin(pins, wikiID)
	})
}

// UnpinWikiEverywhere —— unpublish / delete 钩子:把该条目从所有栏目摘除,
// 返回被摘的栏目名(空 = 本来就没 pin)。caller 把它写进 tool result 声明副作用。
func UnpinWikiEverywhere(
	ctx context.Context, deps PagePinDeps, ownerID, wikiID string,
) ([]string, error) {
	content, err := loadPageContentOrDefault(ctx, PageDeps{Owners: deps.Owners}, ownerID)
	if err != nil {
		return nil, err
	}
	touched := collectTouchedSections(&content, wikiID)
	if len(touched) == 0 {
		return []string{}, nil
	}
	content.Insights = removePin(content.Insights, wikiID)
	content.Projects = removePin(content.Projects, wikiID)
	if _, uerr := deps.Owners.UpsertPageContent(ctx, ownerID, &content); uerr != nil {
		return nil, fmt.Errorf("auto-unpin save: %w", uerr)
	}
	return touched, nil
}

// ValidatePagePins —— admin PUT 整段保存前校验:每个 pin 都存在且 published。
// 跟 PinToPage 共用 checkPinnable —— 单一维护点,不是第二套实现。
func ValidatePagePins(
	ctx context.Context, deps PagePinDeps, ownerID string, content *entity.PageContent,
) error {
	for _, id := range append(append([]string{}, content.Insights...), content.Projects...) {
		if err := checkPinnable(ctx, deps, ownerID, id); err != nil {
			return err
		}
	}
	return nil
}

// ResolvePinCards —— pin 列表 → 渲染卡(title + excerpt + 树派生 path),按 pin
// 序;已删/未发布(兜底)跳过。paths 由 caller 传入(一次 ListAllMeta 服务两个栏目)。
func ResolvePinCards(
	cards map[string]corpus.WikiCard, paths map[string]string, pins []string,
) []entity.PagePinCard {
	out := make([]entity.PagePinCard, 0, len(pins))
	for _, id := range pins {
		card, ok := cards[id]
		if !ok || !card.Published {
			continue
		}
		out = append(out, entity.PagePinCard{
			WikiID: id, Title: card.Title, Excerpt: cardLine(&card), Path: paths[id],
		})
	}
	return out
}

// cardLineMax —— 卡上那句话的上限。比检索行长一些:这是首页,读者停在这儿的时间更长。
const cardLineMax = 180

// cardLine —— 卡上标题下面那句话。**owner 写过就用他的**;没写就从正文派生首句(F-L-47)。
//
// 为什么不是"没写就空着":真 vault 同步不产生 excerpt(1047 条,非空 0 条),于是首页那一栏
// 只剩两行 slug —— 而这一栏正是「我在想什么」。「必须记得手填」的规矩迟早有一次没人记得,
// 能从数据反解的东西不该手填。owner 那份仍然是覆盖:他写了就永远赢。
//
// 派生不出来(整条笔记全是结构)就返回空串 —— 卡上只剩标题,好过把 `> [!i18n] <label…` 摆出去
// ([[display-fallback-reintroduces-the-bug]]:兜底不能把原始标记放出来)。
func cardLine(card *corpus.WikiCard) string {
	if strings.TrimSpace(card.Excerpt) != "" {
		return card.Excerpt
	}
	return corpus.LeadLine(card.Body, cardLineMax)
}

// PinJoin —— 两个栏目 pin 的一次性 join 结果:卡内容 + 全量树路径。
type PinJoin struct {
	Cards map[string]corpus.WikiCard
	Paths map[string]string
}

// LoadPinJoin —— 两个栏目的 pin 一次性 join:卡内容 + 全量树路径。
func LoadPinJoin(
	ctx context.Context, deps PagePinDeps, ownerID string, content *entity.PageContent,
) (PinJoin, error) {
	ids := append(append([]string{}, content.Insights...), content.Projects...)
	if len(ids) == 0 {
		return PinJoin{Cards: map[string]corpus.WikiCard{}, Paths: map[string]string{}}, nil
	}
	cards, err := deps.Wiki.ListCardsByIDs(ctx, ownerID, ids)
	if err != nil {
		return PinJoin{}, fmt.Errorf("pin cards: %w", err)
	}
	metas, err := deps.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return PinJoin{}, fmt.Errorf("pin paths: %w", err)
	}
	return PinJoin{Cards: cards, Paths: corpus.WikiMetaTreePaths(metas)}, nil
}

func checkPinnable(ctx context.Context, deps PagePinDeps, ownerID, wikiID string) error {
	cards, err := deps.Wiki.ListCardsByIDs(ctx, ownerID, []string{wikiID})
	if err != nil {
		return entity.ErrPinNotFound
	}
	card, ok := cards[wikiID]
	if !ok {
		return entity.ErrPinNotFound
	}
	if !card.Published {
		return entity.ErrPinUnpublished
	}
	return nil
}

func mutatePins(
	ctx context.Context, deps PagePinDeps, ownerID, section string,
	mutate func([]string) []string,
) ([]string, error) {
	content, err := loadPageContentOrDefault(ctx, PageDeps{Owners: deps.Owners}, ownerID)
	if err != nil {
		return nil, err
	}
	if aerr := applySectionMutation(&content, section, mutate); aerr != nil {
		return nil, aerr
	}
	saved, err := deps.Owners.UpsertPageContent(ctx, ownerID, &content)
	if err != nil {
		return nil, fmt.Errorf("save pins: %w", err)
	}
	return sectionPins(&saved, section), nil
}

func applySectionMutation(
	content *entity.PageContent, section string, mutate func([]string) []string,
) error {
	switch section {
	case PinSectionInsights:
		content.Insights = mutate(content.Insights)
	case PinSectionProjects:
		content.Projects = mutate(content.Projects)
	default:
		return fmt.Errorf("unknown pin section %q (insights|projects)", section)
	}
	return nil
}

func sectionPins(content *entity.PageContent, section string) []string {
	if section == PinSectionProjects {
		return content.Projects
	}
	return content.Insights
}

func appendPinOnce(pins []string, wikiID string) []string {
	if slices.Contains(pins, wikiID) {
		return pins
	}
	return append(pins, wikiID)
}

func removePin(pins []string, wikiID string) []string {
	out := make([]string, 0, len(pins))
	for _, p := range pins {
		if p != wikiID {
			out = append(out, p)
		}
	}
	return out
}

func collectTouchedSections(content *entity.PageContent, wikiID string) []string {
	touched := []string{}
	if slices.Contains(content.Insights, wikiID) {
		touched = append(touched, PinSectionInsights)
	}
	if slices.Contains(content.Projects, wikiID) {
		touched = append(touched, PinSectionProjects)
	}
	return touched
}
