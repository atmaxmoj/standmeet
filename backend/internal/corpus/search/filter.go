package search

import (
	"strings"
	"unicode"
)

// Eq / Ne / InFilter —— Meili filter clauses with the value quoted. Meili reads a double-quoted
// string with backslash escapes, so a value can carry quotes or operators without leaving its
// clause (a path, a query-derived string).
func Eq(attr, v string) string { return attr + " = " + quote(v) }

// Ne —— attr != v.
func Ne(attr, v string) string { return attr + " != " + quote(v) }

// InFilter —— attr IN [v...].
func InFilter(attr string, vs []string) string {
	q := make([]string, 0, len(vs))
	for _, v := range vs {
		q = append(q, quote(v))
	}
	return attr + " IN [" + strings.Join(q, ", ") + "]"
}

func quote(v string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v) + `"`
}

// Language codes the index splits on. Anything else is indexed and searched as "en": the
// corpus is English and Chinese, and a third code would only split one pass into two.
const (
	LangEN = "en"
	LangZH = "zh"
)

// QueryLang —— a query with any Han character asks in Chinese; otherwise English.
func QueryLang(q string) string {
	for _, r := range q {
		if unicode.Is(unicode.Han, r) {
			return LangZH
		}
	}
	return LangEN
}

// TextLang —— a text whose letters are mostly Han is Chinese; otherwise English. Used for a
// note that declares no language.
func TextLang(s string) string {
	letters := strings.Map(keepIf(unicode.IsLetter), s)
	han := strings.Map(keepIf(func(r rune) bool { return unicode.Is(unicode.Han, r) }), s)
	if letters != "" && 2*len([]rune(han)) >= len([]rune(letters)) {
		return LangZH
	}
	return LangEN
}

// keepIf —— a strings.Map function that keeps the runes ok accepts.
func keepIf(ok func(rune) bool) func(rune) rune {
	return func(r rune) rune {
		if ok(r) {
			return r
		}
		return -1
	}
}

// NormLang —— a declared language code mapped onto the two the index splits on.
func NormLang(code string) string {
	if strings.HasPrefix(strings.ToLower(code), LangZH) {
		return LangZH
	}
	return LangEN
}
