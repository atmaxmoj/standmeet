// form.go —— an application form's questions, and the answers the owner already gave (job-loop
// roadmap 5.4). The owner's AI fills forms; the server only remembers what was answered and says
// which questions the owner must confirm every time.

package jobsmodel

import (
	"errors"
	"regexp"
	"strings"
)

// FormQuestion —— one question a posting's form asks.
type FormQuestion struct {
	PreviousAnswer *PreviousAnswer `json:"previous_answer,omitempty"`
	Label          string          `json:"label"`
	Fields         []FormField     `json:"fields"`
	Required       bool            `json:"required"`
	// Confirm —— the owner confirms this answer each time, even one given before: work
	// authorization, sponsorship, salary, demographic.
	Confirm bool `json:"confirm"`
}

// FormField —— one input of a question; Options for a select.
type FormField struct {
	Name    string   `json:"name"`
	Type    string   `json:"type"`
	Options []string `json:"options"`
}

// PreviousAnswer —— the latest answer the owner gave the same question on another application.
type PreviousAnswer struct {
	Answer        string `json:"answer"`
	ApplicationID string `json:"application_id"`
}

// FormAnswer —— one answer a form was filled with.
type FormAnswer struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// ErrNoAnswers —— save_answers needs at least one answer with a question.
var ErrNoAnswers = errors.New("answers: give at least one {question, answer}")

var (
	keyJunk      = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	confirmWords = regexp.MustCompile(`(?i)\b(authori[sz]|sponsor|visa|citizen|salary|` +
		`compensation|pay\b|wage|gender|race|ethnic|hispanic|latino|veteran|disabilit|pronoun|` +
		`sexual orientation)`)
)

// QuestionKey —— a question as answers are matched: lower case, punctuation and spacing collapsed.
// "Why do you want to work at Beta Labs?" and "why do you want to work at beta labs" are one.
func QuestionKey(label string) string {
	return strings.TrimSpace(keyJunk.ReplaceAllString(strings.ToLower(label), " "))
}

// NeedsConfirm —— whether the owner must confirm the answer to this question every time.
func NeedsConfirm(label string) bool { return confirmWords.MatchString(label) }
