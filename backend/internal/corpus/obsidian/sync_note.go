// sync_note.go —— vault sync 的容错 frontmatter 解析。对齐真实 vault 的 .scripts 契约:frontmatter
// 容错(畸形不崩,对齐 F)。`[[link]]` 提取复用 corpus.ExtractCrossLinks(已对齐 check-links.sh)。

package obsidian

import (
	"regexp"
	"strings"
)

// corpFM —— 一条 corp note 的 frontmatter 精华(sync 只关心这几项;其余 key 忽略,不报错)。
type corpFM struct {
	Excerpt    string
	Visibility string
	Tags       []string
	CSSClasses []string
	// Aliases —— Obsidian 的扁平别名池(多语言笔记里它是各 `aliases-<lang>` 的并集)。
	// `[[别名]]` 靠它解析到本条。跟 tags 同一种值形态(内联数组 / 逗号串 / 单值 / 缩进 list),
	// 所以复用 parseTags —— 不为它另写一个解析器。
	Aliases []string
	Publish bool
}

// parsedNote —— parseCorpNote 的结果(避免多返回名/无名之争)。
type parsedNote struct {
	body string
	fm   corpFM
}

// parseCorpNote —— 容错地拆 frontmatter + body(复用包内 SplitFrontmatter:只认文件头第一段
// `---\n…\n---`,拿不到就整体当 body,body 里的 --- 水平线不误当闭合),再容错解析 frontmatter。
func parseCorpNote(raw []byte) parsedNote {
	text := strings.ReplaceAll(string(raw), "\r\n", newline)
	text = strings.ReplaceAll(text, "\r", newline)
	s := SplitFrontmatter(text)
	return parsedNote{fm: parseFMLines(s.YAML), body: s.Body}
}

var reListItem = regexp.MustCompile(`^\s*-\s*(.+?)\s*$`)

// parseFMLines —— 行式容错解析。key: value;tags 支持 list / 内联数组 / 逗号串 / 单值;
// publish 与老名 seo_indexed 都强转 bool;未知 key 直接忽略(不报错)。重复 key 后者覆盖。
func parseFMLines(fm string) corpFM {
	out := corpFM{}
	lines := strings.Split(fm, newline)
	for i := range lines {
		kv := splitKV(lines[i])
		if !kv.ok {
			continue
		}
		if into := listFieldOf(&out, kv.key); into != nil {
			*into = parseTags(kv.val, lines, i) // list-form 值需向后看(缩进 `- x`)
			continue
		}
		applyScalarFM(&out, kv.key, kv.val)
	}
	return out
}

// applyScalarFM —— 写标量 frontmatter(publish/excerpt/visibility + 老名);未知 key 忽略不报错。
func applyScalarFM(out *corpFM, key, val string) {
	switch key {
	case "publish", "seo_indexed":
		out.Publish = coerceBool(val)
	case "excerpt", "seo_description":
		out.Excerpt = unquote(val)
	case "visibility":
		out.Visibility = unquote(val)
	default:
	}
}

// kvLine —— 一行 frontmatter 的解析结果。
type kvLine struct {
	key string
	val string
	ok  bool
}

// isTopLevelLine —— 非空、非缩进、非 list item 的顶层行(才可能是 key: value)。
func isTopLevelLine(line string) bool {
	return line != "" && line[0] != ' ' && line[0] != '\t' && line[0] != '-'
}

// splitKV —— 顶层 `key: value`(key 是字母数字/下划线/连字符)。缩进行(list item 等)不是 kv。
func splitKV(line string) kvLine {
	if !isTopLevelLine(line) {
		return kvLine{}
	}
	rawKey, val, found := strings.Cut(line, ":")
	if !found {
		return kvLine{}
	}
	key := strings.TrimSpace(rawKey)
	if key == "" || !isBareKey(key) {
		return kvLine{}
	}
	return kvLine{key: key, val: strings.TrimSpace(val), ok: true}
}

var reBareKey = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func isBareKey(k string) bool { return reBareKey.MatchString(k) }

// listFieldOf —— 走 list 解析的那几个 key → 该写进哪个字段。不认识的 key 返 nil(交给标量那条)。
//
// 三个 key(tags / cssclasses / aliases)的值形态**完全一样**(内联数组 / 逗号串 / 单值 /
// 缩进 list),所以它们共用 parseTags;一人一个 if 分支只是把同一件事写了三遍,而且每加一个
// list 型 frontmatter key 就把这个函数的复杂度再推高一格。
func listFieldOf(fm *corpFM, key string) *[]string {
	switch key {
	case "tags":
		return &fm.Tags
	case "cssclasses":
		return &fm.CSSClasses
	case "aliases":
		return &fm.Aliases
	default:
		return nil
	}
}

// parseTags —— tags 值:内联数组 `[a, b]` / 逗号串 `a, b` / 单值 `a` / 空(→ 跟随的缩进 `- x` list)。
// i 只向后看 list item(主循环随后遇到缩进行会因非 kv 而跳过,不重复处理)。
func parseTags(val string, lines []string, i int) []string {
	val = strings.TrimSpace(val)
	if val == "" {
		return consumeListItems(lines, i)
	}
	if after, ok := strings.CutPrefix(val, "["); ok {
		val = strings.TrimSuffix(after, "]")
	}
	return splitCommaTags(val)
}

func consumeListItems(lines []string, i int) []string {
	out := []string{}
	for j := i + 1; j < len(lines); j++ {
		m := reListItem.FindStringSubmatch(lines[j])
		if m == nil {
			break
		}
		if t := strings.TrimSpace(unquote(m[1])); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func splitCommaTags(val string) []string {
	out := []string{}
	for p := range strings.SplitSeq(val, ",") {
		if t := strings.TrimSpace(unquote(p)); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func coerceBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(unquote(v))) {
	case "true", "yes", "1", "on":
		return true
	}
	return false
}

func unquote(v string) string {
	v = strings.TrimSpace(v)
	if len(v) < 2 {
		return v
	}
	first, last := v[0], v[len(v)-1]
	if first == last && (first == '"' || first == '\'') {
		return v[1 : len(v)-1]
	}
	return v
}
