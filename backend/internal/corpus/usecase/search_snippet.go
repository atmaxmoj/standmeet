// search_snippet.go —— 把数据库给的**命中片段**清成一句能直接给人看的话。
//
// 为什么不能复用 `LeadLine`：那个函数回答的是「这条笔记的第一句正文是什么」，
// 它按行找**第一行散文**，而 `isProseLine` 把 `>` 开头的行当结构跳过。
// 这个 vault 的正文**几乎全都**包在 `> > ` 两层引用里（i18n callout 的语言面），
// 于是 LeadLine 对这些笔记返回空 —— 那正是 F-L-45 的深层机制：
// 搜索结果一行摘要都没有，owner 拿到的是一串 slug。
//
// 片段跟「开头」是两种东西：片段是从正文中间切下来的一段，第一行多半是半截标记。
// 所以这里的做法是**先拆掉包装再拼**：去引用前缀 → 去 callout 标记 → 去 HTML 标签 →
// 去行内强调/wikilink 目标，剩下的按空格连起来。清完还是空的，就返回空
// （空摘要好过把 `> [!i18n] > <label><input type="radio"…` 摆给 owner 看）。

package usecase

import (
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

var (
	// quotePrefixRe —— 行首的引用层（`> `、`> > `、`>>`）。callout 的正文就住在里面。
	quotePrefixRe = regexp.MustCompile(`^(?:\s*>+\s?)+`)
	// calloutMarkerRe —— Obsidian 的 callout 标记（`[!i18n]` / `[!lang] en`）。
	calloutMarkerRe = regexp.MustCompile(`\[![a-zA-Z0-9_-]+\]\s*[a-zA-Z-]*`)
	// htmlTagRe —— 片段里混着的裸 HTML（语言切换那排 `<label><input …>`）。
	htmlTagRe = regexp.MustCompile(`<[^>]*>`)
	// headingHashRe —— 行首的 `#`，去掉之后标题行本身可以当摘要用。
	headingHashRe = regexp.MustCompile(`^#{1,6}\s*`)
)

// snippetLinesGuess —— 一个片段清完通常剩几行（`MaxFragments=1` 的窗口很短）。只是初始容量。
const snippetLinesGuess = 4

// SearchSnippet —— 命中片段 → 一句人话（截到 limit 字节，按字符边界）。
func SearchSnippet(fragment string, limit int) string {
	parts := make([]string, 0, snippetLinesGuess)
	for raw := range strings.SplitSeq(fragment, "\n") {
		line := unwrapSnippetLine(raw)
		if line == "" {
			continue
		}
		parts = append(parts, line)
	}
	return textcut.BytesMark(strings.Join(parts, " "), limit)
}

// unwrapSnippetLine —— 一行：拆包装、去标记，返回可读的那部分（没有就返回空串）。
func unwrapSnippetLine(raw string) string {
	line := quotePrefixRe.ReplaceAllString(strings.TrimSpace(raw), "")
	line = calloutMarkerRe.ReplaceAllString(line, "")
	line = htmlTagRe.ReplaceAllString(line, "")
	line = headingHashRe.ReplaceAllString(line, "")
	return cleanLead(line)
}
