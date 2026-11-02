// background.go —— the background/intro question and its completeness guarantee.
//
// A "tell me about yourself / your background / why this role" opener must get the WHOLE résumé
// (卡片完整度 spec): every summary fact and every experience, not a sampled subset. The card is a model
// rewrite under a terse format, so coverage varied run to run. The server appends the deterministic
// full recap (Resume.renderCard, on Prompt.resumeCard) so a background card is always complete and
// stable across runs — the model still writes the lead and why-this-company.

package cues

import (
	"regexp"
	"strings"
)

// backgroundRE —— an intro / background / why-this-role opener. Patterns, not a model call (like
// stackSource and storyRE): a prompt decision drifts run to run. English only — gosmopolitan bars
// Han runes in a literal, and the postings are answered in English; a Chinese opener is a follow-up
// (a golangci allowance or an escaped pattern). Add a phrasing on a miss.
var backgroundRE = regexp.MustCompile(
	`(?i)tell me about (yourself|your background|your experience)|` +
		`walk me through (your|the) (background|experience|resume|career|cv)|` +
		`your background|introduce yourself|a bit about yourself|` +
		`who are you|what('?s| is) your background|` +
		`why (do you want|are you interested in|this (role|company|job|position))`,
)

// isBackgroundQuestion —— whether the line is an intro / background / why-this-role opener.
func isBackgroundQuestion(line string) bool {
	return backgroundRE.MatchString(line)
}

// withBackgroundRecap —— append the full recap to a background card, so it carries every summary
// fact and experience (卡片完整度) whatever the model sampled. An empty recap (no résumé bound) or a
// non-background question leaves the card unchanged — no-binding sessions and other questions are
// exactly as before.
func withBackgroundRecap(card, recap, question string) string {
	if recap == "" || !isBackgroundQuestion(question) {
		return card
	}
	if strings.TrimSpace(card) == "" {
		return recap
	}
	return card + "\n\n" + recap
}
