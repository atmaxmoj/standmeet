// parse.go —— 正文 → Doc。纯字符串处理,不认识 markdown 渲染器。
//
// 只按**行**看:blockquote 的每一层前缀是 "> ",所以 `[!i18n]` 在深度 1、`[!lang]` 在深度 2。
// 深度 3 及以上的 callout 是 pane 里面的东西(模板里就有 `i18n > lang > tip`),不是 pane。

package i18n

import (
	"slices"
	"strings"
)

// Pane —— 一个语言面:语言码 + 这一面的 markdown(已去掉 callout 前缀)。
type Pane struct {
	Lang string
	Body string
}

// Region —— 正文里的一段。Panes 为空 = 语言中性的散文(每种语言下都出现)。
type Region struct {
	Neutral string
	Panes   []Pane
}

// Doc —— 一条笔记的多语结构。
type Doc struct {
	// Langs —— 出现过的语言码,按第一次出现的顺序。空 = 这条笔记是单语的。
	Langs   []string
	Regions []Region
}

// Multilingual —— 这条笔记有没有多语区块。
func (d *Doc) Multilingual() bool { return len(d.Langs) > 0 }

// Parse —— 正文拆成"中性散文"和"多语区块"两种段落,按出现顺序。
func Parse(body string) Doc {
	doc := Doc{Regions: []Region{}, Langs: []string{}}
	var neutral []string
	lines := strings.Split(normalizeNewlines(body), "\n")
	for i := 0; i < len(lines); i++ {
		if skip, ok := fenceSpan(lines, i); ok {
			neutral = append(neutral, lines[i:skip+1]...)
			i = skip
			continue
		}
		if !isI18nOpener(lines[i]) {
			neutral = append(neutral, lines[i])
			continue
		}
		end := blockEnd(lines, i)
		doc.flushNeutral(&neutral)
		doc.addRegion(regionOf(lines[i:end]))
		i = end - 1
	}
	doc.flushNeutral(&neutral)
	return doc
}

func (d *Doc) flushNeutral(buf *[]string) {
	text := strings.TrimSpace(strings.Join(*buf, "\n"))
	*buf = nil
	if text == "" {
		return
	}
	d.Regions = append(d.Regions, Region{Neutral: text})
}

func (d *Doc) addRegion(r Region) {
	d.Regions = append(d.Regions, r)
	for i := range r.Panes {
		if !contains(d.Langs, r.Panes[i].Lang) {
			d.Langs = append(d.Langs, r.Panes[i].Lang)
		}
	}
}

// regionOf —— 一个 `[!i18n]` 区块的行 → 它的 pane。
//
// 按钮行(`<label><input type=radio>` 那一串)在深度 1 上,不属于任何 pane —— 它是 Obsidian
// 的呈现件,我们自己出切换器,所以这里直接丢掉:它连"中性散文"都不是。
func regionOf(lines []string) Region {
	panes := []Pane{}
	open := -1 // 当前 pane 在 panes 里的下标;-1 = 还没进任何 pane
	var buf []string
	for _, raw := range lines[1:] { // lines[0] 是 `> [!i18n]`
		inner := strings.TrimPrefix(strings.TrimPrefix(raw, ">"), " ")
		if code, ok := langOpener(inner); ok {
			panes = closePane(panes, open, buf)
			buf = nil
			panes = append(panes, Pane{Lang: code})
			open = len(panes) - 1
			continue
		}
		if open < 0 {
			continue // 按钮行 / 空行:区块里、任何 pane 之外
		}
		buf = append(buf, strings.TrimPrefix(strings.TrimPrefix(inner, ">"), " "))
	}
	return Region{Panes: closePane(panes, open, buf)}
}

// closePane —— 把攒下的行写进第 open 个 pane。open < 0(还没进过 pane)时原样返回。
func closePane(panes []Pane, open int, buf []string) []Pane {
	if open < 0 {
		return panes
	}
	panes[open].Body = strings.TrimSpace(strings.Join(buf, "\n"))
	return panes
}

// isI18nOpener —— 深度 1 的 `[!i18n]`。
func isI18nOpener(line string) bool {
	inner, ok := stripQuote(line)
	if !ok {
		return false
	}
	m := reCalloutMarker.FindStringSubmatch(strings.TrimSpace(inner))
	return len(m) > 1 && strings.EqualFold(m[1], "i18n")
}

// langOpener —— 区块里某一行是不是一个 pane 的开头(深度 2 的 `[!lang] code`)。
func langOpener(inner string) (string, bool) {
	rest, ok := stripQuote(inner)
	if !ok {
		return "", false
	}
	m := reCalloutMarker.FindStringSubmatch(strings.TrimSpace(rest))
	if len(m) < 3 || !strings.EqualFold(m[1], "lang") {
		return "", false
	}
	return strings.ToLower(strings.TrimSpace(m[2])), true
}

// stripQuote —— 去掉一层 "> "。不是引用行 → false。
func stripQuote(line string) (string, bool) {
	t := strings.TrimLeft(line, " \t")
	if !strings.HasPrefix(t, ">") {
		return "", false
	}
	return strings.TrimPrefix(strings.TrimPrefix(t, ">"), " "), true
}

// blockEnd —— 从 start 起第一行不属于这个引用块的行号(即区块的开区间右端)。
func blockEnd(lines []string, start int) int {
	i := start + 1
	for ; i < len(lines); i++ {
		if !stillInBlock(lines, i) {
			break
		}
	}
	return i
}

// stillInBlock —— 第 i 行还属不属于这个引用块。空行只有在后面还有引用行时才算块内
// (区块内部用空行分隔 pane);非引用的实体行一律是块外。
func stillInBlock(lines []string, i int) bool {
	if _, ok := stripQuote(lines[i]); ok {
		return true
	}
	return strings.TrimSpace(lines[i]) == "" && continuesQuote(lines, i)
}

// continuesQuote —— 空行之后还有没有引用行(区块内部允许空行分隔 pane)。
func continuesQuote(lines []string, i int) bool {
	for j := i + 1; j < len(lines); j++ {
		if strings.TrimSpace(lines[j]) == "" {
			continue
		}
		_, ok := stripQuote(lines[j])
		return ok
	}
	return false
}

// fenceSpan —— i 起是不是一个围栏代码块;是则返回结束行号。围栏里的一切原样当中性散文,
// 里面的 `[!i18n]` 不是区块。
func fenceSpan(lines []string, i int) (int, bool) {
	if !reFence.MatchString(lines[i]) {
		return 0, false
	}
	marker := strings.TrimSpace(lines[i])[:3]
	for j := i + 1; j < len(lines); j++ {
		if strings.HasPrefix(strings.TrimSpace(lines[j]), marker) {
			return j, true
		}
	}
	return len(lines) - 1, true // 没闭合:到文件末尾都算围栏里
}

func normalizeNewlines(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}

func contains(xs []string, want string) bool {
	return slices.Contains(xs, want)
}
