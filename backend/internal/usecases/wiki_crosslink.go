// wiki_crosslink.go —— wiki body 里 Obsidian `[[Title]]` 的渲染期 rewrite。
// 镜像 crosslink.go(writings),但 wiki 无 slug:只按 title 解析,目标是树派生
// path → `[Title](/wiki/<path>)`。存储永远存原始 `[[X]]`(owner 写啥存啥),读时
// 才 rewrite;unresolved 留 literal 当文字。
//
// 解析与抽取复用 crosslink.go 的 ExtractCrossLinks / HasCrossLinks / CrossLinkRef。

package usecases

import (
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
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
