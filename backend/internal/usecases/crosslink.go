// crosslink.go —— post body_md 里 `[[X]]` 双链的解析 + 渲染期 rewrite。
//
// **存储**：body_md 永远存原始 `[[X]]`（owner 写啥存啥；Obsidian export
// round-trip 也保 literal）。
// **读时（public /blog GET）**：server pre-resolve `[[X]]` → 真 post slug
// → rewrite body_md 成 `[Title](/blog/<slug>)` 标准 markdown 再发给前端；
// 不识别的留 literal `[[X]]` 当文字。
// **写时（SavePost）**：同 tx 抽 [[X]] → resolve → 把 src→dst 边表
// (post_links) 重建。
//
// Resolution 规则（跟 Quartz CrawlLinks 对齐）：
//  1. 先按 slug case-insensitive 精确匹配
//  2. 没中再按 title case-insensitive 匹配
//  3. 都没中：返 unresolved，render 那侧留原 [[X]]，边表不入这条

package usecases

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

// CrossLinkRefScheme —— body_md 里的双链字面前缀。
const crossLinkOpen = "[["

// crossLinkPattern —— 抓 `[[X]]` 跟 `[[X|alias]]` 两种 obsidian-flavored
// 形态。group 1 = 目标 (slug 或 title)，group 2 = optional alias。
// 不抓嵌套或 escape，跟 Quartz 一样保守。
var crossLinkPattern = regexp.MustCompile(`\[\[([^\]|]+)(?:\|([^\]]*))?\]\]`)

// CrossLinkRef —— 抽出来的一条 [[...]]。
type CrossLinkRef struct {
	Original string // 原文（含 [[ ]]）
	Target   string // 目标（slug 或 title，已 trim）
	Alias    string // 可选显示文本（"|" 后面），空 = 用 dst 的 title
}

// ExtractCrossLinks —— body_md 里所有 `[[X]]` 引用，按出现顺序。
func ExtractCrossLinks(body string) []CrossLinkRef {
	matches := crossLinkPattern.FindAllStringSubmatch(body, -1)
	out := make([]CrossLinkRef, 0, len(matches))
	for _, m := range matches {
		alias := ""
		if len(m) > 2 {
			alias = strings.TrimSpace(m[2])
		}
		out = append(out, CrossLinkRef{
			Original: m[0],
			Target:   strings.TrimSpace(m[1]),
			Alias:    alias,
		})
	}
	return out
}

// ResolvedLink —— Resolution 完后的一条 link。dst nil 表示 unresolved。
type ResolvedLink struct {
	Dst *domain.Post // nil = unresolved（render 留 literal）
	Ref CrossLinkRef
}

// ResolveCrossLinks —— 一组 ref 解到对应 post。candidates 是 owner 的所有
// post（caller 已查过，避免反复 round-trip）。规则 Quartz-style：slug
// 先（case-insensitive 精确），title fallback（同 normalize）。
func ResolveCrossLinks(
	refs []CrossLinkRef, candidates []domain.Post,
) []ResolvedLink {
	idx := indexCandidates(candidates)
	out := make([]ResolvedLink, 0, len(refs))
	for i := range refs {
		out = append(out, resolveCrossLinkOne(&refs[i], idx))
	}
	return out
}

// postIndex —— slug+title 两张 case-insensitive 索引打包。
type postIndex struct {
	bySlug, byTitle map[string]*domain.Post
}

func indexCandidates(candidates []domain.Post) postIndex {
	idx := postIndex{
		bySlug:  make(map[string]*domain.Post, len(candidates)),
		byTitle: make(map[string]*domain.Post, len(candidates)),
	}
	for i := range candidates {
		idx.bySlug[strings.ToLower(candidates[i].Slug)] = &candidates[i]
		idx.byTitle[strings.ToLower(candidates[i].Title)] = &candidates[i]
	}
	return idx
}

func resolveCrossLinkOne(ref *CrossLinkRef, idx postIndex) ResolvedLink {
	key := strings.ToLower(ref.Target)
	if dst, ok := idx.bySlug[key]; ok {
		return ResolvedLink{Ref: *ref, Dst: dst}
	}
	if dst, ok := idx.byTitle[key]; ok {
		return ResolvedLink{Ref: *ref, Dst: dst}
	}
	return ResolvedLink{Ref: *ref, Dst: nil}
}

// RewriteCrossLinksToMarkdown —— public /blog render 用：把 body_md 里每条
// `[[X]]` 换成 `[显示文本](/blog/<slug>)`。unresolved 留 literal `[[X]]`。
// 显示文本：alias 优先 > dst.Title。
func RewriteCrossLinksToMarkdown(body string, resolved []ResolvedLink) string {
	for i := range resolved {
		r := &resolved[i]
		if r.Dst == nil {
			continue
		}
		display := r.Ref.Alias
		if display == "" {
			display = r.Dst.Title
		}
		replacement := fmt.Sprintf("[%s](/blog/%s)", display, r.Dst.Slug)
		body = strings.ReplaceAll(body, r.Ref.Original, replacement)
	}
	return body
}

// DedupResolvedDsts —— 从 resolved 列表抽 dst post.id 去重（SavePost 写
// post_links 边表时用，避免 (src,dst) 主键撞）。unresolved 跳过。
func DedupResolvedDsts(resolved []ResolvedLink) []string {
	seen := make(map[string]struct{}, len(resolved))
	out := make([]string, 0, len(resolved))
	for i := range resolved {
		if resolved[i].Dst == nil {
			continue
		}
		id := resolved[i].Dst.ID
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// resolveAndDedupForOwner —— SavePost 用的便捷封装：从 body 抽 refs →
// resolve against candidates → 输出去重后的 dst id 列表（用来重建边表）。
func resolveAndDedupForOwner(body string, candidates []domain.Post) []string {
	refs := ExtractCrossLinks(body)
	if len(refs) == 0 {
		return nil
	}
	return DedupResolvedDsts(ResolveCrossLinks(refs, candidates))
}

// HasCrossLinks —— body 里有没有 `[[X]]`。避免没 link 的 post save 时也
// 跑 candidate list 查询。
func HasCrossLinks(body string) bool {
	return strings.Contains(body, crossLinkOpen)
}

// SlugTitle —— public /blog 路径用的 light index，避免在 candidates list
// 里搬 body_md。跟 postgres.SlugTitle 同 shape，独立 type 保 usecase 不
// import postgres 类型。
type SlugTitle struct {
	Slug  string
	Title string
}

// RewriteCrossLinksForRender —— public /blog GET 用：body_md 里 `[[X]]`
// resolve 到 candidate slug+title → 替换成 `[Title](/blog/<slug>)`
// 标准 markdown；unresolved 留原文。
//
// 跟 SavePost 那边走的 ResolveCrossLinks 是同一套 resolver，但只需要 slug
// + title（不需要 full domain.Post），所以走自己的轻 index。
func RewriteCrossLinksForRender(body string, index []SlugTitle) string {
	if !HasCrossLinks(body) || len(index) == 0 {
		return body
	}
	slim := indexSlugTitle(index)
	refs := ExtractCrossLinks(body)
	for i := range refs {
		body = applyOneCrossLinkRewrite(body, &refs[i], slim)
	}
	return body
}

// slugTitleIndex —— SlugTitle 版本的 case-insensitive 双索引。
type slugTitleIndex struct {
	bySlug, byTitle map[string]*SlugTitle
}

func indexSlugTitle(index []SlugTitle) slugTitleIndex {
	out := slugTitleIndex{
		bySlug:  make(map[string]*SlugTitle, len(index)),
		byTitle: make(map[string]*SlugTitle, len(index)),
	}
	for i := range index {
		out.bySlug[strings.ToLower(index[i].Slug)] = &index[i]
		out.byTitle[strings.ToLower(index[i].Title)] = &index[i]
	}
	return out
}

func applyOneCrossLinkRewrite(
	body string, ref *CrossLinkRef, idx slugTitleIndex,
) string {
	dst := resolveSlugTitle(ref.Target, idx)
	if dst == nil {
		return body
	}
	display := ref.Alias
	if display == "" {
		display = dst.Title
	}
	replacement := fmt.Sprintf("[%s](/blog/%s)", display, dst.Slug)
	return strings.ReplaceAll(body, ref.Original, replacement)
}

func resolveSlugTitle(target string, idx slugTitleIndex) *SlugTitle {
	key := strings.ToLower(target)
	if dst, ok := idx.bySlug[key]; ok {
		return dst
	}
	if dst, ok := idx.byTitle[key]; ok {
		return dst
	}
	return nil
}
