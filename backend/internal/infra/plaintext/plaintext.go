// Package plaintext —— turns a piece of externally-sourced HTML into readable text, in one place.
//
// Why this package earns its keep: **whether what came back is markup or text is a boundary
// concern, not each adapter's personal taste.**
// The F-E-7 scene: on `/admin/listings`, the HN rows come through as one solid line:
// `IVPN | Infrastructure Engineer &#x2F; Sysadmin | … | <a href="https:&#x2F;…`,
// while greenhouse's body is **double-escaped**: `&lt;div class=&quot;…`. Along the whole
// jobs-fetch path, `html.UnescapeString` had zero hits — the missing piece wasn't a fix for
// one field, it was this step itself.
//
// Two things happen in order, neither optional:
//  1. **Unescape repeatedly.** The upstream source may have escaped more than once (greenhouse
//     does), and a single Unescape only turns `&amp;lt;div&amp;gt;` into `&lt;div&gt;` — looks
//     clean but is still markup.
//  2. **Strip tags**, leaving one space per block-level tag so `a</p><p>b` doesn't squash
//     into `ab`.
//
// The output is **plain text only** (list titles, text fed to the model). It is not a sanitizer:
// don't render its result as HTML.
package plaintext

import (
	"html"
	"strings"
	"unicode"
)

// maxUnescapePasses —— how many unescape passes to run at most. Upstream double-escaping is
// real (greenhouse); a third layer has never been seen. The cap exists because "run until it
// stops changing" can be dragged out on malicious input.
const maxUnescapePasses = 3

// FromHTML —— HTML (possibly escaped several times) → a readable plain-text string.
func FromHTML(s string) string {
	return collapseSpace(html.UnescapeString(stripTags(unescapeDeep(s))))
}

// unescapeDeep —— unescape until it stops changing (or the cap is hit).
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

// stripTags —— strips `<...>`, replacing each tag with one space.
//
// A space, not a straight delete: deleting `<p>a</p><p>b</p>` outright would leave `ab`,
// gluing two sentences into one word. collapseSpace tidies the spaces afterward.
func stripTags(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	depth := 0
	for _, r := range s {
		depth = writeOutsideTag(&b, r, depth)
	}
	return b.String()
}

// writeOutsideTag —— advances by one character: entering a tag emits one space, leaving a tag
// closes it, and a character is only written when outside a tag. Returns the new depth (`<`
// can nest inside an attribute, so this counts rather than just toggling a bool).
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

// collapseSpace —— collapses runs of whitespace to one space and trims both ends. The list
// view renders this as a single line.
func collapseSpace(s string) string {
	return strings.Join(strings.FieldsFunc(s, unicode.IsSpace), " ")
}
