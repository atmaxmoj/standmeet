// number_check.go —— numbers in a draft that the owner's master never states (job-loop roadmap
// 5.2). A warning, never a refusal: the AI may have the number from the corpus, but a figure a
// recruiter can quote back must have a source the owner can point to.
//
// Read as claims: a number, with a %, x, k/M/B or a time unit. Not claims: a year (19xx, 20xx), and
// a duration ("2 years 11 months"). Chinese numerals are not read, so a draft with Chinese text
// reports coverage partial — never "nothing unsupported" it did not look for.

package jobsmodel

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Number-check coverage.
const (
	NumbersFull    = "full"
	NumbersPartial = "partial"
	NumbersNone    = "none"
)

// NumberClaim —— one number the master does not state, where it is, and its sentence.
type NumberClaim struct {
	Key   string `json:"key"`
	Claim string `json:"claim"`
	Text  string `json:"text"`
}

// NumberCheck —— the draft's unsupported numbers, and how much of the draft was read.
type NumberCheck struct {
	Coverage    string        `json:"coverage"`
	Unsupported []NumberClaim `json:"unsupported"`
}

var (
	numberRE   = regexp.MustCompile(`\d+(?:[.,]\d+)*(?:\s?(?:%|x\b|×|k\b|K\b|M\b|B\b|ms\b))?`)
	yearRE     = regexp.MustCompile(`^(19|20)\d{2}$`)
	durationRE = regexp.MustCompile(`(?i)^\s*(years?|yrs?|months?|mos?|weeks?|days?)\b`)
	hanRE      = regexp.MustCompile(`\p{Han}`)
)

// CheckNumbers —— the draft's numbers against the master's (nil master: coverage none).
func CheckNumbers(master, draft *ResumeContent) NumberCheck {
	if master == nil {
		return NumberCheck{Coverage: NumbersNone, Unsupported: []NumberClaim{}}
	}
	known := knownClaims(master)
	out := NumberCheck{Coverage: NumbersFull, Unsupported: []NumberClaim{}}
	for _, f := range textFields(draft) {
		if hanRE.MatchString(f.text) {
			out.Coverage = NumbersPartial
		}
		out.Unsupported = append(out.Unsupported, unknownClaims(f, known)...)
	}
	return out
}

// knownClaims —— every number the master states.
func knownClaims(master *ResumeContent) map[string]bool {
	known := map[string]bool{}
	for _, f := range textFields(master) {
		for _, c := range claimsIn(f.text) {
			known[c] = true
		}
	}
	return known
}

func unknownClaims(f textField, known map[string]bool) []NumberClaim {
	var out []NumberClaim
	for _, c := range claimsIn(f.text) {
		if !known[c] {
			out = append(out, NumberClaim{Key: f.key, Claim: c, Text: f.text})
		}
	}
	return out
}

// claimsIn —— the number claims in a text, normalized (no inner space): "40 %" and "40%" are one.
func claimsIn(text string) []string {
	var out []string
	for _, loc := range numberRE.FindAllStringIndex(text, -1) {
		claim := strings.ReplaceAll(text[loc[0]:loc[1]], " ", "")
		if partOfName(text, loc[0]) || yearRE.MatchString(claim) ||
			durationRE.MatchString(text[loc[1]:]) {
			continue
		}
		out = append(out, claim)
	}
	return out
}

// partOfName —— a number glued to letters before it, directly or by a hyphen, is part of a name
// (p99, H1B, ES2015, top-1, GPT-4), not a claim.
func partOfName(text string, at int) bool {
	before := strings.TrimSuffix(text[:at], "-")
	r, _ := utf8.DecodeLastRuneInString(before)
	return unicode.IsLetter(r)
}

type textField struct{ key, text string }

// textFields —— the prose a recruiter reads, keyed as the draft check keys it.
func textFields(c *ResumeContent) []textField {
	out := []textField{{"summary", c.Summary}, {"cover_letter", c.CoverLetter}}
	for i := range c.Works {
		for j, b := range c.Works[i].Bullets {
			out = append(out, textField{fmt.Sprintf("works[%d].bullets[%d]", i, j), b})
		}
	}
	return out
}
