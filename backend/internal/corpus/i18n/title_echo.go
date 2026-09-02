// title_echo.go — strip the line at the start of the body that just repeats the title.
//
// A vault note is **self-sufficient** inside Obsidian: there is no page header there,
// so the author writes `# Title` again at the top of the body. Moved to a reader page,
// the header already prints the title, so the same sentence gets said twice, right
// next to each other (UX-85).
//
// **Strip only the ones that match verbatim.** This rule was measured from the vault,
// not invented:
//
//   - 985 panes open with **a different sentence** (the English pane of the
//     `the-business-model-wedge` note opens with
//     `# Attack the business model, not the feature list`) — that is content, the
//     note's real title sentence in that language, and must not be touched at all.
//   - 199 panes plus 141 monolingual notes open with the same text as the filename
//     (`recursive-harness` / `# Recursive harness`) — these are the actual duplicates.
//
// "Same text" is decided by **equality after normalization**: keep only letters and
// digits (CJK counts as letters too), case and hyphens don't count. So
// `recursive-harness` recognizes `Recursive harness`, while
// `Recursive harness in agents` is not recognized — the latter says more, it is content.

package i18n

import (
	"strings"
	"unicode"
)

// StripTitleEcho — strips the "repeats the title again" line at the start of every
// pane (edits doc in place).
//
// Checks every pane, not just the first one: by the i18n contract, the `# …` line at
// the start of a pane is that pane's title, and when it matches the note's title
// verbatim it is a duplicate — no matter which region it's in.
func StripTitleEcho(doc *Doc, title string) {
	for r := range doc.Regions {
		for p := range doc.Regions[r].Panes {
			doc.Regions[r].Panes[p].Body = StripLeadingTitle(doc.Regions[r].Panes[p].Body, title)
		}
	}
}

// StripLeadingTitle — strips the "repeats the title again" line at the start of a
// single-language body. Returns it unchanged when the text doesn't match.
//
// Only looks at the **first non-blank line**: the duplicate's shape is "the body opens
// by restating the title". A same-named subheading further down is structure (a
// "Definitions" section), not a duplicate.
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

// isTitleEcho — is this line "an ATX heading, and does it match the title verbatim".
func isTitleEcho(line, want string) bool {
	text := strings.TrimLeft(strings.TrimSpace(line), "#")
	if len(text) == len(strings.TrimSpace(line)) { // no leading # at all → not a heading line
		return false
	}
	return normalizeTitle(text) == want
}

// normalizeTitle — keeps only letters and digits, lowercased. `recursive-harness` and
// `Recursive harness` normalize to the same string; the CJK characters in `递归
// Harness` are unicode.IsLetter, so they are kept as-is.
func normalizeTitle(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out = append(out, unicode.ToLower(r))
		}
	}
	return string(out)
}
