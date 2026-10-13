// homework.go —— the recruiter-facing half of the owner's homework must not carry what only the
// owner decides to tell: pay, and residence or work authorization. Checked when it is written.

package jobsmodel

import (
	_ "embed"
	"errors"
	"fmt"
	"regexp"
)

// ErrHomeworkPrivate —— homework names something private; the row keeps what it had.
var ErrHomeworkPrivate = errors.New("homework is read by the recruiter's agent")

// payTermList —— pay words, one per line, en and zh (data, like the immigration terms).
//
//go:embed pay_terms.txt
var payTermList string

var (
	payTerms = termsRE(payTermList)
	// payFigure —— a currency figure ("$180") or a thousands figure ("180k").
	payFigure = regexp.MustCompile(`(?i)[$€£¥]\s?\d|\b\d{2,3}\s?k\b`)
)

// CheckHomework —— nil, or why the homework cannot be shown to a recruiter.
func CheckHomework(text string) error {
	if payTerms.MatchString(text) || payFigure.MatchString(text) {
		return fmt.Errorf("%w: keep pay out of it (it stays in your brief)", ErrHomeworkPrivate)
	}
	if immigrationTerms.MatchString(text) {
		return fmt.Errorf("%w: keep work authorization out of it (it stays in your brief)",
			ErrHomeworkPrivate)
	}
	return nil
}
