// Package plaintext —— 把一段来自外部的 HTML 变成可读文本,一处实现。
//
// 为什么值得有个包：**取回来的东西是标记还是文字，是个边界问题，不是每个适配器各自的口味。**
// F-E-7 的现场：`/admin/listings` 上 HN 那些行整行都是
// `IVPN | Infrastructure Engineer &#x2F; Sysadmin | … | <a href="https:&#x2F;…`，
// 而 greenhouse 的 body 是**双重转义**的 `&lt;div class=&quot;…`。整条 jobs 取数路径上
// `html.UnescapeString` 零命中 —— 缺的不是某个字段的一刀，是这一步本身。
//
// 两件事按顺序做，缺一不可：
//  1. **反复反转义**。上游可能转义了不止一次（greenhouse 就是），一次 Unescape 只会把
//     `&amp;lt;div&amp;gt;` 变成 `&lt;div&gt;` —— 看起来干净了，其实还是标记。
//  2. **去标签**，块级标签留一个空白，免得 `a</p><p>b` 挤成 `ab`。
//
// 产出**只当纯文本用**（列表标题、喂给模型的正文）。它不是消毒器：别拿它的结果去当 HTML 渲染。
package plaintext

import (
	"html"
	"strings"
	"unicode"
)

// maxUnescapePasses —— 反转义最多跑几遍。上游双重转义是真事（greenhouse），三层没见过；
// 给个上限是因为「一直跑到不动为止」在恶意输入下是可以被拉长的。
const maxUnescapePasses = 3

// FromHTML —— HTML（可能被转义过若干次）→ 可读的一段纯文本。
func FromHTML(s string) string {
	return collapseSpace(html.UnescapeString(stripTags(unescapeDeep(s))))
}

// unescapeDeep —— 反转义直到不再变化（或到上限）。
func unescapeDeep(s string) string {
	for range maxUnescapePasses {
		next := html.UnescapeString(s)
		if next == s {
			return s
		}
		s = next
	}
	return s
}

// stripTags —— 去掉 `<...>`，每个标签换成一个空格。
//
// 换成空格而不是直接删：`<p>a</p><p>b</p>` 直接删会变成 `ab`，两句话粘成一个词。
// 空格由 collapseSpace 收干净。
func stripTags(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	depth := 0
	for _, r := range s {
		depth = writeOutsideTag(&b, r, depth)
	}
	return b.String()
}

// writeOutsideTag —— 一个字符走一步：进标签就吐一个空格、出标签就收，只有在标签外才写它。
// 返回新的深度（`<` 可以嵌在属性里，所以要计数而不是布尔）。
func writeOutsideTag(b *strings.Builder, r rune, depth int) int {
	if r == '<' {
		_ = b.WriteByte(' ')
		return depth + 1
	}
	if r == '>' && depth > 0 {
		return depth - 1
	}
	if depth == 0 {
		_, _ = b.WriteRune(r)
	}
	return depth
}

// collapseSpace —— 连续空白压成一个空格，两端切掉。列表里那一行是单行显示的。
func collapseSpace(s string) string {
	return strings.Join(strings.FieldsFunc(s, unicode.IsSpace), " ")
}
