// parse.go —— body -> Doc. Pure string processing, no markdown renderer involved.
//
// Reads by **line** only: each blockquote nesting level adds a "> " prefix, so `[!i18n]`
// sits at depth 1 and `[!lang]` at depth 2. A callout at depth 3+ is something living
// inside a pane (the template itself nests `i18n > lang > tip`), not a pane itself.

package i18n

import (
	"slices"
	"strings"
)

// Pane —— one language face: a language code plus that face's markdown
// (callout prefix stripped).
type Pane struct {
	Lang string
	Body string
}

// Region —— one segment of the body. Empty Panes = language-neutral prose
// (shown under every language).
type Region struct {
	Neutral string
	Panes   []Pane
}

// Doc —— the multilingual structure of one note.
type Doc struct {
	// Langs —— language codes seen, in order of first appearance.
	// Empty = this note is monolingual.
	Langs   []string
	Regions []Region
}

// Multilingual —— whether this note has any multilingual block.
func (d *Doc) Multilingual() bool { return len(d.Langs) > 0 }

// Parse —— splits the body into "neutral prose" and "multilingual block" segments,
// in order of appearance.
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

// regionOf —— the lines of one `[!i18n]` block -> its panes.
//
// The button row (the `<label><input type=radio>` string) sits at depth 1 and belongs to
// no pane — it's Obsidian's own rendering widget, and we ship our own switcher, so it's
// dropped outright here: it doesn't even count as "neutral prose".
func regionOf(lines []string) Region {
	panes := []Pane{}
	open := -1 // index of the currently open pane in panes; -1 = not inside any pane yet
	var buf []string
	for _, raw := range lines[1:] { // lines[0] is `> [!i18n]`
		inner := strings.TrimPrefix(strings.TrimPrefix(raw, ">"), " ")
		if code, ok := langOpener(inner); ok {
			panes = closePane(panes, open, buf)
			buf = nil
			panes = append(panes, Pane{Lang: code})
			open = len(panes) - 1
			continue
		}
		if open < 0 {
			continue // button row / blank line: inside the block, outside any pane
		}
		buf = append(buf, strings.TrimPrefix(strings.TrimPrefix(inner, ">"), " "))
	}
	return Region{Panes: closePane(panes, open, buf)}
}

// closePane —— writes the buffered lines into pane index open. Returns unchanged if
// open < 0 (never entered a pane).
func closePane(panes []Pane, open int, buf []string) []Pane {
	if open < 0 {
		return panes
	}
	panes[open].Body = strings.TrimSpace(strings.Join(buf, "\n"))
	return panes
}

// isI18nOpener —— a depth-1 `[!i18n]`.
func isI18nOpener(line string) bool {
	inner, ok := stripQuote(line)
	if !ok {
		return false
	}
	m := reCalloutMarker.FindStringSubmatch(strings.TrimSpace(inner))
	return len(m) > 1 && strings.EqualFold(m[1], "i18n")
}

// langOpener —— whether a line inside a block opens a pane (a depth-2 `[!lang] code`).
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

// stripQuote —— strips one level of "> ". Not a quote line -> false.
func stripQuote(line string) (string, bool) {
	t := strings.TrimLeft(line, " \t")
	if !strings.HasPrefix(t, ">") {
		return "", false
	}
	return strings.TrimPrefix(strings.TrimPrefix(t, ">"), " "), true
}

// blockEnd —— the index of the first line after start that no longer belongs to this
// quote block (the open-interval right edge of the block).
func blockEnd(lines []string, start int) int {
	i := start + 1
	for ; i < len(lines); i++ {
		if !stillInBlock(lines, i) {
			break
		}
	}
	return i
}

// stillInBlock —— whether line i still belongs to this quote block. A blank line only
// counts as inside the block if a quote line follows later (blank lines separate panes
// inside a block); any non-quote content line is always outside the block.
func stillInBlock(lines []string, i int) bool {
	if _, ok := stripQuote(lines[i]); ok {
		return true
	}
	return strings.TrimSpace(lines[i]) == "" && continuesQuote(lines, i)
}

// continuesQuote —— whether a quote line follows after this blank line (a block may
// use blank lines internally to separate panes).
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

// fenceSpan —— whether a fenced code block starts at i; if so, returns its end line.
// Everything inside a fence is treated verbatim as neutral prose — a `[!i18n]` inside
// one is not a block.
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
	return len(lines) - 1, true // unclosed: everything to end of file counts as inside the fence
}

func normalizeNewlines(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
}

func contains(xs []string, want string) bool {
	return slices.Contains(xs, want)
}
