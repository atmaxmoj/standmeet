// export_fm_patch.go — replaces only the LINES THAT ACTUALLY CHANGED in the vault's
// original text; every other byte stays untouched.
//
// Whether something "changed" is judged with the same parser (parseFMLines): what
// the raw text itself says tags are, compared against what the DB says now. Equal
// means leave those lines alone — touching them would rewrite `tags: [a, b]` into
// an indented list even though the value never changed. A different judgment (say,
// a "has the web edited this" timestamp) would also work, but that introduces a
// second source of truth; here the only question asked is "does this key's value
// still match what the raw text said?"

package obsidian

import (
	"slices"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// patchFrontmatter — takes the vault's raw text, swaps out product-owned keys that
// have changed, and returns the new block (fences excluded).
func patchFrontmatter(raw string, n *corpus.SyncNote) string {
	was := parseFMLines(raw)
	lines := strings.Split(raw, newline)
	appended := []string{}
	for _, f := range ownedFrontmatter(n) {
		if f.sameAsVault(&was) {
			continue // value unchanged → leave the raw lines as-is, form preserved too
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

// replaceKeyLines — replaces the `key:` line, together with the indented list
// following it, with want.
// Key not found → returns unchanged + false (the caller appends it to the block's tail).
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

// isContinuationLine — a line that belongs to the previous key's continuation
// (an indented `- x` or `k: v`).
func isContinuationLine(line string) bool {
	return line != "" && (line[0] == ' ' || line[0] == '\t' || line[0] == '-')
}

// sortedKeys — sorts a map's keys for deterministic output (see the note on pairLines).
func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}
