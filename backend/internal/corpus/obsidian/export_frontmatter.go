// export_frontmatter.go — what the frontmatter block should look like on export.
//
// Two origins, two write paths:
//
//   · The note **came from the vault** (has an `obsidian_frontmatter` original) → **patch**
//     the original: only rewrite, in place, the lines whose key was actually edited on the
//     web; everything else is carried back verbatim.
//   · The note was **created on the web / via MCP** (no original) → render field-by-field
//     as before.
//
// Why not unify on "always re-render field-by-field" (half the code): the product only
// knows about a dozen keys, while the owner's vault also carries `langs` (596 real-vault
// notes), `aliases-zh` (595 notes), `owns` (33 notes). Re-rendering would delete them.
// Shape matters too — re-rendering `tags: [a, b]` turns it into an indented list and
// reorders the keys: same content, different bytes. In a git-tracked vault, that is a
// fake diff on every single sync.
//
// Why not unify on "always echo the original verbatim": edits made on the web must be
// reflected back, or the mirror would be saying stale things.
//
// —— Three facts about one key, kept together ——
// Each `fmField` carries both **how to render it** and **how to compare it against the
// original**. These two used to live apart (a field table + a switch dispatched by
// key), so adding a key meant remembering to edit both places, and missing either one
// failed silently: miss the comparison → that key gets rewritten on every export (a
// fake diff); miss the rendering → that key gets deleted. Keeping them together, you
// can't forget one.

package obsidian

import (
	"strconv"
	"strings"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// fmField — one product-owned frontmatter key: how its current value is rendered,
// and whether it still agrees with what the original said.
type fmField struct {
	// sameAsVault — does the original still say this value? If yes → those lines are
	// kept verbatim, preserving their shape too.
	sameAsVault func(was *corpFM) bool
	key         string
	lines       []string
}

// ownedFrontmatter — the keys the product owns on export. Slice order = the write
// order used when there is no original.
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

// publishField — when the original **has no** publish key at all, that does not count
// as "changed". Most notes in the real vault have no publish key, and adding one would
// add a diff to every single note (same family as F-L-22).
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

// renderOwnedBlock — how it's written when there is no original: rendered in the
// order given by ownedFrontmatter.
func renderOwnedBlock(n *corpus.SyncNote) string {
	lines := []string{}
	for _, f := range ownedFrontmatter(n) {
		lines = append(lines, f.lines...)
	}
	return strings.Join(lines, newline)
}

// scalarLines — `key: value`. An empty value writes no line at all (equivalent to
// "this key is absent" on the import side).
func scalarLines(key, val string) []string {
	if val == "" {
		return []string{}
	}
	return []string{key + ": " + val}
}

// listLines — `key:` plus an indented list. An empty list writes no line at all.
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

// pairLines — `key:` plus indented `code: label` lines, sorted by code: Go's map
// iteration order is randomized, and without sorting, exporting the same note twice
// in a row would yield two different byte streams — exactly what this bug family
// exists to eliminate.
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
