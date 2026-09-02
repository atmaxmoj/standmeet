// select.go —— "which body should this reader see".
//
// A note is **not** N documents, so picking a language isn't picking a document:
// neutral prose passes through unchanged, and a multilingual block is swapped for
// that one face. This same rule serves three call sites: the reader page, search
// (one hit, not N), and the context fed to an agent (one language at a time, not
// all N crammed in).

package i18n

import "strings"

// Render —— reassembles the body into a single monolingual markdown for the want language.
//
// If want is empty, or this note has no pane for it, falls back to fallback
// (frontmatter's lang); if even that has no pane, falls back to the first pane.
// **Never attach one face to a different language label**: the whole note falls
// back, never a guessed segment.
func Render(doc *Doc, want, fallback string) string {
	if !doc.Multilingual() {
		return joinNeutral(doc)
	}
	pick := Resolve(doc, want, fallback)
	parts := make([]string, 0, len(doc.Regions))
	for i := range doc.Regions {
		if part := regionText(&doc.Regions[i], pick); part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, "\n\n")
}

// Resolve —— which language code actually gets used.
//
// Order: what the reader wants -> the identity language (lang) -> the first pane.
// When `?lang=de` lands on a note with no German pane, the result is lang, **not**
// langs[0] — lang is this note's identity, langs[0] is just whichever happens to
// come first.
func Resolve(doc *Doc, want, fallback string) string {
	if code := strings.ToLower(strings.TrimSpace(want)); contains(doc.Langs, code) {
		return code
	}
	if code := strings.ToLower(strings.TrimSpace(fallback)); contains(doc.Langs, code) {
		return code
	}
	if len(doc.Langs) > 0 {
		return doc.Langs[0]
	}
	return ""
}

// regionText —— how a segment looks under the chosen language: a neutral segment
// passes through as-is, a multilingual segment takes that one face (no such face -> empty).
func regionText(r *Region, lang string) string {
	if len(r.Panes) == 0 {
		return r.Neutral
	}
	for i := range r.Panes {
		if r.Panes[i].Lang == lang {
			return r.Panes[i].Body
		}
	}
	return ""
}

func joinNeutral(doc *Doc) string {
	parts := make([]string, 0, len(doc.Regions))
	for i := range doc.Regions {
		if doc.Regions[i].Neutral != "" {
			parts = append(parts, doc.Regions[i].Neutral)
		}
	}
	return strings.Join(parts, "\n\n")
}

// Label —— what this language code shows as in the switcher.
//
// The rule comes from the vault's own lang-labels: if the owner wrote one, use it;
// otherwise derive one from the code — a non-Latin script gets its native spelling
// (zh -> 中文), everything else gets uppercased (fr -> FR). No second rule is invented.
func Label(code string, labels map[string]string) string {
	if l, ok := labels[code]; ok && strings.TrimSpace(l) != "" {
		return l
	}
	if l, ok := builtinLabels[strings.ToLower(code)]; ok {
		return l
	}
	return strings.ToUpper(code)
}

// builtinLabels —— default spellings for non-Latin scripts: a Chinese reader seeing
// "ZH" would take it for someone else's language.
//
//nolint:gosmopolitan // this table's content IS each language's own spelling; ASCII defeats it
var builtinLabels = map[string]string{
	"zh": "中文", "zh-hans": "简体", "zh-hant": "繁體",
	"ja": "日本語", "ko": "한국어", "ru": "Русский",
	"ar": "العربية", "he": "עברית", "th": "ไทย", "el": "Ελληνικά",
}
