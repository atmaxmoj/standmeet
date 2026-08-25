// export_frontmatter.go —— 导出时那一块 frontmatter 该长什么样。
//
// 两种来路，两种写法：
//
//   · 这条笔记**来自 vault**（存着 `obsidian_frontmatter` 原文）→ 拿原文**打补丁**：
//     产品拥有的 key 只有在网页上被改过时才就地改那几行，其余原样带回去。
//   · 这条笔记是**网页 / MCP 新建的**（没有原文）→ 照旧按字段渲染。
//
// 为什么不统一成「按字段重新渲染」（那样代码少一半）：产品只认识十来个 key，而 owner 的
// vault 上还写着 `langs`（真 vault 596 篇）、`aliases-zh`（595 篇）、`owns`（33 篇）。
// 重新渲染等于把它们删了。形态也一样重要 —— `tags: [a, b]` 重渲会变成缩进 list，键序也会重排，
// 内容一样而字节不一样：在一个 git 管着的 vault 里，那是每次同步都发生一遍的假 diff。
//
// 为什么不统一成「原样回吐」：网页上改过的东西必须反映出去，否则镜像说的是旧话。
//
// ── 一个 key 的三件事写在一起 ────────────────────────────────────────────────────────
// 每个 `fmField` 自带**怎么渲染**和**怎么跟原文比**。这两件事最早是分开的（一张字段表 +
// 一个按 key 分派的 switch），于是加一个 key 要记得改两处，而漏掉哪一处都不报错：
// 漏了比较 → 那个 key 每次导出都被重写一遍（假 diff）；漏了渲染 → 那个 key 被删。
// 合在一起之后，忘不掉。

package obsidian

import (
	"strconv"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// fmField —— 一个产品拥有的 frontmatter key：它现在的值怎么写，以及它跟原文说的是否一致。
type fmField struct {
	// sameAsVault —— 原文说的还是这个值吗。是 → 那几行原样留着，形态一并保住。
	sameAsVault func(was *corpFM) bool
	key         string
	lines       []string
}

// ownedFrontmatter —— 导出时产品拥有的那几个 key。切片顺序 = 没有原文时的书写顺序。
func ownedFrontmatter(n *corpus.SyncNote) []fmField {
	return []fmField{
		publishField(n.Published),
		scalarField("lang", n.Lang, func(was *corpFM) string { return was.Lang }),
		pairField("lang-labels", n.LangLabels),
		listField("aliases", n.Aliases, func(was *corpFM) []string { return was.Aliases }),
		listField("tags", n.Tags, func(was *corpFM) []string { return was.Tags }),
		listField("cssclasses", n.CSSClasses, func(was *corpFM) []string { return was.CSSClasses }),
		scalarField("excerpt", n.Excerpt, func(was *corpFM) string { return was.Excerpt }),
	}
}

// publishField —— 原文**没写** publish 时不算「变了」。真 vault 的绝大多数笔记一个 publish
// 键都没有，而补一行上去就是给每一条笔记加一条 diff（F-L-22 的同族）。
func publishField(published bool) fmField {
	now := strconv.FormatBool(published)
	return fmField{
		key:   "publish",
		lines: []string{"publish: " + now},
		sameAsVault: func(was *corpFM) bool {
			return !was.PublishSet || strconv.FormatBool(was.Publish) == now
		},
	}
}

func scalarField(key, now string, of func(*corpFM) string) fmField {
	return fmField{
		key:         key,
		lines:       scalarLines(key, now),
		sameAsVault: func(was *corpFM) bool { return of(was) == now },
	}
}

func listField(key string, now []string, of func(*corpFM) []string) fmField {
	return fmField{
		key:         key,
		lines:       listLines(key, now),
		sameAsVault: func(was *corpFM) bool { return sameList(of(was), now) },
	}
}

func pairField(key string, now map[string]string) fmField {
	return fmField{
		key:         key,
		lines:       pairLines(key, now),
		sameAsVault: func(was *corpFM) bool { return sameLabels(was.LangLabels, now) },
	}
}

// renderOwnedBlock —— 没有原文时的写法：按 ownedFrontmatter 的顺序渲染。
func renderOwnedBlock(n *corpus.SyncNote) string {
	lines := []string{}
	for _, f := range ownedFrontmatter(n) {
		lines = append(lines, f.lines...)
	}
	return strings.Join(lines, newline)
}

// scalarLines —— `key: value`。空值一行都不写（跟 import 侧「没有这个键」等价）。
func scalarLines(key, val string) []string {
	if val == "" {
		return []string{}
	}
	return []string{key + ": " + val}
}

// listLines —— `key:` + 缩进 list。空一行都不写。
func listLines(key string, vals []string) []string {
	if len(vals) == 0 {
		return []string{}
	}
	out := make([]string, 0, 1+len(vals))
	out = append(out, key+":")
	for _, v := range vals {
		out = append(out, "  - "+v)
	}
	return out
}

// pairLines —— `key:` + 缩进 `码: 字`。按码排序：Go 的 map 迭代顺序是随机的，不排的话
// 同一条笔记连导两次会得到两份不同的字节 —— 那正是这一族缺陷要消灭的东西。
func pairLines(key string, pairs map[string]string) []string {
	if len(pairs) == 0 {
		return []string{}
	}
	out := make([]string, 0, 1+len(pairs))
	out = append(out, key+":")
	for _, code := range sortedKeys(pairs) {
		out = append(out, "  "+code+": "+pairs[code])
	}
	return out
}
