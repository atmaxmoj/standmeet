// Package textcut -- cuts a piece of text, one implementation.
//
// Why this deserves a package: `s[:n]` cuts by **byte**, and if n lands mid-way through a
// multi-byte character it slices that character in half. The consequence depends on where
// it lands: a corrupted title propagates all the way to postgres and the whole INSERT gets
// rejected (`invalid byte sequence for encoding "UTF8"`), so the owner just sees "this note
// won't save", with not a single word in the error about the title. Chinese characters are
// 3 bytes each, so for a Chinese vault this isn't an edge case: one line of 21 Chinese
// characters already trips it.
//
// This bug has happened in this repo at least four times (job-scraped titles, raw's derived
// titles, wiki's path segments, evidence summaries), and each time a private helper got
// patched in on the spot -- so the same thing ended up with four implementations and three
// different semantics. This consolidates it into one place: the unit is explicit (characters
// vs bytes), and whether truncation leaves a mark is explicit too.
package textcut

import "unicode/utf8"

// Mark -- the marker left by truncation. Use it in human-facing text to signal "there's
// more"; machine-read addresses (path segments, slugs) must not carry it -- use Runes there.
const Mark = "…"

// Runes -- at most n characters, **leaves no mark**. For things that go into an address,
// like path segments / slugs.
func Runes(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// RunesMark -- at most n characters; if cut, appends a Mark at the end. For human-facing
// short text like titles.
func RunesMark(s string, n int) string {
	cut := Runes(s, n)
	if cut == s {
		return s
	}
	return cut + Mark
}

// BytesMark -- at most n **bytes**, and never slices a character in half; if cut, appends
// a Mark.
//
// The unit is bytes rather than characters because its callers are **budgets** (evidence
// summaries, snippet caps): what matters is how much space this takes up, not how many
// characters it has. The mark itself doesn't count against n.
func BytesMark(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len(s) <= n {
		return s
	}
	cut := s[:n]
	for cut != "" && !utf8.ValidString(cut) {
		cut = cut[:len(cut)-1]
	}
	return cut + Mark
}
