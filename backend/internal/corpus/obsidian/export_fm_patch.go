// export_fm_patch.go —— 把 vault 原文里**变过的那几行**换掉，其余一个字节不动。
//
// 判「变没变」用的是同一个解析器（parseFMLines）：原文自己说 tags 是什么，跟 DB 现在说的
// 比一比。相等就别碰那几行 —— 碰了就等于把 `tags: [a, b]` 改写成缩进 list，而值根本没变。
// 用另一套判断（比如「网页动过没有」的时间戳）也 work，但那要引入第二个真相来源；
// 这里只问一句「这个 key 的值现在还是原文说的那个吗」。

package obsidian

import (
	"slices"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// patchFrontmatter —— 拿 vault 原文，换掉产品拥有且已经变了的 key，返回新的块（不含围栏）。
func patchFrontmatter(raw string, n *corpus.SyncNote) string {
	was := parseFMLines(raw)
	lines := strings.Split(raw, newline)
	appended := []string{}
	for _, f := range ownedFrontmatter(n) {
		if f.sameAsVault(&was) {
			continue // 值没变 → 原文那几行原样留着，形态一并保住
		}
		var replaced bool
		lines, replaced = replaceKeyLines(lines, f.key, f.lines)
		if !replaced {
			appended = append(appended, f.lines...)
		}
	}
	return strings.Join(append(lines, appended...), newline)
}

func sameList(a, b []string) bool { return slices.Equal(a, b) }

func sameLabels(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// replaceKeyLines —— 把 `key:` 那一行连同它后面的缩进 list 一起换成 want。
// 找不到这个 key → 原样返回 + false（由调用方追加到块尾）。
func replaceKeyLines(lines []string, key string, want []string) ([]string, bool) {
	at := indexOfKey(lines, key)
	if at < 0 {
		return lines, false
	}
	end := at + 1
	for end < len(lines) && isContinuationLine(lines[end]) {
		end++
	}
	out := make([]string, 0, len(lines)+len(want))
	out = append(out, lines[:at]...)
	out = append(out, want...)
	return append(out, lines[end:]...), true
}

func indexOfKey(lines []string, key string) int {
	for i := range lines {
		if kv := splitKV(lines[i]); kv.ok && kv.key == key {
			return i
		}
	}
	return -1
}

// isContinuationLine —— 属于上一个 key 的续行（缩进的 `- x` 或 `k: v`）。
func isContinuationLine(line string) bool {
	return line != "" && (line[0] == ' ' || line[0] == '\t' || line[0] == '-')
}

// sortedKeys —— map 的键排序输出（见 pairLines 上的说明）。
func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}
