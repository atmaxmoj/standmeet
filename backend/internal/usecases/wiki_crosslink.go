// wiki_crosslink.go —— wiki body 里 Obsidian `[[Title]]` 的渲染期 rewrite。
// 镜像 crosslink.go(writings),但 wiki 无 slug:只按 title 解析,目标是树派生
// path → `[Title](/wiki/<path>)`。存储永远存原始 `[[X]]`(owner 写啥存啥),读时
// 才 rewrite;unresolved 留 literal 当文字。
//
// 解析与抽取复用 crosslink.go 的 ExtractCrossLinks / HasCrossLinks / CrossLinkRef。

package usecases

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// wikiLinkPrefix —— rewrite 出来的 markdown 链接前缀(reader 路由 /wiki/<path>)。
const wikiLinkPrefix = "/wiki/"

// WikiPathTitle —— 一条 wiki 的 title + 树派生 path,给 `[[Title]]` 解析用。
type WikiPathTitle struct {
	Title string
	Path  string
}

// RewriteWikiCrossLinksForRender —— public wiki landing render:body 里每条
// `[[Title]]`(或 `[[Title|alias]]`)按 title(case-insensitive)解析到 wiki 的
// 树派生 path,换成 `[显示文本](/wiki/<path>)`。unresolved 留原 `[[X]]`。
func RewriteWikiCrossLinksForRender(body string, index []WikiPathTitle) string {
	if !HasCrossLinks(body) || len(index) == 0 {
		return body
	}
	byTitle := indexWikiByTitle(index)
	refs := ExtractCrossLinks(body)
	for i := range refs {
		body = applyOneWikiRewrite(body, &refs[i], byTitle)
	}
	return body
}

func indexWikiByTitle(index []WikiPathTitle) map[string]*WikiPathTitle {
	out := make(map[string]*WikiPathTitle, len(index))
	for i := range index {
		out[strings.ToLower(index[i].Title)] = &index[i]
	}
	return out
}

func applyOneWikiRewrite(
	body string, ref *CrossLinkRef, byTitle map[string]*WikiPathTitle,
) string {
	dst, ok := byTitle[strings.ToLower(ref.Target)]
	if !ok {
		return body
	}
	display := ref.Alias
	if display == "" {
		display = dst.Title
	}
	replacement := fmt.Sprintf("[%s](%s%s)", display, wikiLinkPrefix, dst.Path)
	return strings.ReplaceAll(body, ref.Original, replacement)
}

// WikiPathTitleIndex —— 从全树 + 派生 path 抽出可作链接目标的 (title, path) 列。
// 只收 seo_indexed:公开链接目标必须可访问,否则点进去 404。
func WikiPathTitleIndex(wikis []domain.Wiki, paths map[string]string) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(wikis))
	for i := range wikis {
		if wikis[i].SEOIndexed() {
			out = append(out, WikiPathTitle{Title: wikis[i].Title(), Path: paths[wikis[i].ID()]})
		}
	}
	return out
}

// wikiMetaPathTitleIndex —— WikiPathTitleIndex 的 meta 版(无 body):landing 渲染
// [[X]] 用全量 meta 建 title→path,deep entry 的链接也不断。
func wikiMetaPathTitleIndex(
	metas []postgres.WikiMeta, paths map[string]string,
) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(metas))
	for i := range metas {
		if metas[i].SEOIndexed {
			out = append(out, WikiPathTitle{Title: metas[i].Title, Path: paths[metas[i].ID]})
		}
	}
	return out
}

// RebuildWikiRefs —— wiki 写后(promote/create/update)重建这条的出度边:抽 body
// 的 `[[Title]]` → 按 title 解析到 owner 的 wiki id → 重写 wiki_refs。没 `[[]]`
// 也要清空旧边(owner 删了链接也算)。边表是派生索引,不要求跟写同事务。
func RebuildWikiRefs(
	ctx context.Context, deps CorpusDeps, ownerID, wikiID, body string,
) error {
	if !HasCrossLinks(body) {
		return clearWikiRefs(ctx, deps, ownerID, wikiID)
	}
	// 全量 meta(无 50-cap):[[X]] 可指向语料里任一条,deep target 也要解析得到边,
	// 否则 backlink/related 静默漏。
	metas, err := deps.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list wiki for crosslink: %w", err)
	}
	dstIDs := resolveWikiDstIDs(body, metas, wikiID)
	if rerr := deps.WikiRefs.ReplaceRefsBySrc(ctx, wikiID, ownerID, dstIDs); rerr != nil {
		return fmt.Errorf("rebuild wiki refs: %w", rerr)
	}
	return nil
}

func clearWikiRefs(ctx context.Context, deps CorpusDeps, ownerID, wikiID string) error {
	if err := deps.WikiRefs.ReplaceRefsBySrc(ctx, wikiID, ownerID, []string{}); err != nil {
		return fmt.Errorf("clear wiki refs: %w", err)
	}
	return nil
}

// resolveWikiDstIDs —— body 的 `[[Title]]` 按 title(case-insensitive)解析到 owner
// wiki id,去重 + 排除 self-link。
func resolveWikiDstIDs(body string, metas []postgres.WikiMeta, selfID string) []string {
	byTitle := wikiMetaTitleToID(metas)
	refs := ExtractCrossLinks(body)
	seen := make(map[string]struct{}, len(refs))
	out := make([]string, 0, len(refs))
	for i := range refs {
		out = appendResolvedDst(out, seen, byTitle, refs[i].Target, selfID)
	}
	return out
}

func wikiMetaTitleToID(metas []postgres.WikiMeta) map[string]string {
	byTitle := make(map[string]string, len(metas))
	for i := range metas {
		byTitle[strings.ToLower(metas[i].Title)] = metas[i].ID
	}
	return byTitle
}

func appendResolvedDst(
	out []string, seen map[string]struct{}, byTitle map[string]string, target, selfID string,
) []string {
	id, ok := byTitle[strings.ToLower(target)]
	if !ok || id == selfID {
		return out
	}
	if _, dup := seen[id]; dup {
		return out
	}
	seen[id] = struct{}{}
	return append(out, id)
}
