// title_echo.go —— 正文开头又把标题说了一遍的那一行,不渲染。
//
// vault 里的笔记在 Obsidian 里是**自足**的:那儿没有页头,所以作者在正文开头再写一次
// `# 标题`。搬到读者页上,页头已经印了标题,于是同一句话上下挨着说两遍(UX-85)。
//
// **只去同字的那一份。** 这条规矩是从 vault 量出来的,不是想出来的:
//
//   - 985 个 pane 的开头是**另一句话**(`the-business-model-wedge` 这条笔记的英文面开头是
//     `# Attack the business model, not the feature list`)—— 那是内容,是这条笔记在那种
//     语言下真正的标题句,一个字都不许动。
//   - 199 个 pane + 141 条单语笔记的开头跟文件名同字(`recursive-harness` /
//     `# Recursive harness`)—— 这些才是重复。
//
// 同字的判法是**归一化后相等**:只留字母和数字(CJK 也是字母),大小写和连字符都不算数。
// 于是 `recursive-harness` 认得出 `Recursive harness`,而 `Recursive harness in agents`
// 认不出 —— 后者多说了话,它是内容。

package i18n

import (
	"strings"
	"unicode"
)

// StripTitleEcho —— 把每个 pane 开头那句"又说一遍标题"去掉(就地改 doc)。
//
// 每个 pane 都看,不只第一个:按 i18n 契约,pane 开头那行 `# …` 就是这一面的标题,
// 它跟笔记标题同字时是重复,在第几个区块里都一样。
func StripTitleEcho(doc *Doc, title string) {
	for r := range doc.Regions {
		for p := range doc.Regions[r].Panes {
			doc.Regions[r].Panes[p].Body = StripLeadingTitle(doc.Regions[r].Panes[p].Body, title)
		}
	}
}

// StripLeadingTitle —— 一份单语正文开头那句"又说一遍标题"去掉。不同字就原样返回。
//
// 只看**第一个非空行**:重复的形状是"正文开头就把标题重说一遍"。正文中段一个同名小标题
// 是结构(「Definitions」那节),不是重复。
func StripLeadingTitle(body, title string) string {
	want := normalizeTitle(title)
	if want == "" {
		return body
	}
	lines := strings.Split(normalizeNewlines(body), "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if !isTitleEcho(line, want) {
			return body
		}
		return strings.TrimLeft(strings.Join(append(lines[:i:i], lines[i+1:]...), "\n"), "\n")
	}
	return body
}

// isTitleEcho —— 这一行是不是"一个 ATX 标题,而且跟标题同字"。
func isTitleEcho(line, want string) bool {
	text := strings.TrimLeft(strings.TrimSpace(line), "#")
	if len(text) == len(strings.TrimSpace(line)) { // 一个 # 都没有 → 不是标题行
		return false
	}
	return normalizeTitle(text) == want
}

// normalizeTitle —— 只留字母和数字并小写。`recursive-harness` 与 `Recursive harness`
// 归一到同一串;`递归 Harness` 里的汉字是 unicode.IsLetter,照留。
func normalizeTitle(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out = append(out, unicode.ToLower(r))
		}
	}
	return string(out)
}
