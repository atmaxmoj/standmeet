// text.go —— a note's body as the cue card reads it: the English pane, as plain prose, cut into
// its "## " sections. Ported from the desktop app (cheating-daddy src/utils/standmeet.js) so the
// server's context is byte for byte the app's; the JavaScript semantics that differ from Go's
// are spelled out here: \s is Unicode whitespace, trim() is JavaScript's, and slice() counts
// UTF-16 code units.

package cues

import (
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	noteChars    = 4000 // kept per note (and searched)
	contextChars = 2000 // per note in a prompt
	projectChars = 400  // per project in the overview
)

// jsSpace —— every character JavaScript's \s matches (RE2's \s is ASCII only), as the body of
// a character class.
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}` +
	`\x{205f}\x{3000}\x{feff}`

var (
	quoteRE    = regexp.MustCompile(`^([` + jsSpace + `]*>[` + jsSpace + `]?)+`)
	fenceRE    = regexp.MustCompile("(?s)```.*?```")
	tagRE      = regexp.MustCompile(`<[^>]+>`)
	aliasRE    = regexp.MustCompile(`\[\[([^\]|]+)\|([^\]]+)\]\]`)
	linkRE     = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
	calloutRE  = regexp.MustCompile(`\[!i18n\]|\[!lang\][^\n]*`)
	hashesRE   = regexp.MustCompile(`(?m)^#+[` + jsSpace + `]*`)
	blanksRE   = regexp.MustCompile(`[ \t]+`)
	gapRE      = regexp.MustCompile(`\n{3,}`)
	headingRE  = regexp.MustCompile(`^##[` + jsSpace + `]+([^\n\r\x{2028}\x{2029}]+)`)
	spacesRE   = regexp.MustCompile(`[` + jsSpace + `]+`)
	breakRE    = regexp.MustCompile(`\n##`)
	oneSpaceRE = regexp.MustCompile(`^[` + jsSpace + `]$`)
	langMarker = "[!lang] en"
)

func isJSSpace(r rune) bool { return oneSpaceRE.MatchString(string(r)) }

// jsTrim —— String.prototype.trim.
func jsTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }

// prefix16 —— s.slice(0, n): the first n UTF-16 code units.
// ponytail: a cut through a surrogate pair drops the pair (JavaScript keeps half of it).
func prefix16(s string, n int) string {
	units := 0
	for i, r := range s {
		w := max(1, utf16.RuneLen(r))
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

// englishPane —— the English pane of a bilingual note with quoting, HTML, code and link
// brackets removed; headings kept.
func englishPane(body string) string {
	text := body
	if en := strings.Index(text, langMarker); en >= 0 {
		rest := text[en+len(langMarker):]
		if next := strings.Index(rest, "[!lang]"); next >= 0 {
			rest = rest[:next]
		}
		text = rest
	}
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = quoteRE.ReplaceAllString(l, "")
	}
	text = strings.Join(lines, "\n")
	text = fenceRE.ReplaceAllString(text, " ")
	text = tagRE.ReplaceAllString(text, " ")
	text = aliasRE.ReplaceAllString(text, "${2}")
	text = linkRE.ReplaceAllString(text, "${1}")
	return calloutRE.ReplaceAllString(text, " ")
}

func plain(text string) string {
	text = hashesRE.ReplaceAllString(text, "")
	text = blanksRE.ReplaceAllString(text, " ")
	text = gapRE.ReplaceAllString(text, "\n\n")
	return jsTrim(text)
}

// cleanBody —— the note as plain prose, cut to noteChars.
func cleanBody(body string) string { return prefix16(plain(englishPane(body)), noteChars) }

type section struct{ heading, text string }

// sections —— a note split at its "## " headings: a question pulls in the one section that
// answers it, not the note's opening.
func sections(body string) []section {
	out := []section{}
	for _, s := range splitAtHeadings(englishPane(body)) {
		heading := ""
		if m := headingRE.FindStringSubmatch(s); m != nil {
			heading = jsTrim(m[1])
		}
		if t := prefix16(plain(s), noteChars); t != "" {
			out = append(out, section{heading: heading, text: t})
		}
	}
	return out
}

// splitAtHeadings —— split(/\n(?=##\s)/): at each newline followed by "##" and a space.
func splitAtHeadings(s string) []string {
	var parts []string
	start := 0
	for _, at := range breakRE.FindAllStringIndex(s, -1) {
		if r, _ := utf8.DecodeRuneInString(s[at[1]:]); isJSSpace(r) {
			parts = append(parts, s[start:at[0]])
			start = at[0] + 1
		}
	}
	return append(parts, s[start:])
}
