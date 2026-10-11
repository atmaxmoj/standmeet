// engagement.go —— what a recruiter asked on an application's code, what the agent answered, and
// where the corpus ran out (job-loop roadmap 2.1, 2.3, 2.5).

package jobsmodel

import (
	"regexp"
	"slices"
	"strings"
	"time"
)

// Exchange —— one question and the agent's answer. Grounded: the answer stood on the corpus.
// Topics: what the answer committed the owner to (pay, start, availability, authorization).
type Exchange struct {
	AskedAt        time.Time `json:"asked_at"`
	ApplicationID  string    `json:"-"`
	ConversationID string    `json:"conversation_id"`
	Question       string    `json:"question"`
	Answer         string    `json:"answer"`
	Topics         []string  `json:"topics"`
	Grounded       bool      `json:"grounded"`
}

// Engagement —— an application's exchanges and how many are gaps.
type Engagement struct {
	Questions []Exchange `json:"questions"`
	Gaps      int        `json:"gaps"`
}

// Gap —— a question the corpus could not answer, across applications.
type Gap struct {
	Question       string   `json:"question"`
	ApplicationIDs []string `json:"application_ids"`
	Count          int      `json:"count"`
}

// topicRules —— the commitments an owner wants quoted back before they meet the recruiter (2.3).
var topicRules = []struct {
	re    *regexp.Regexp
	topic string
}{
	{regexp.MustCompile(`(?i)\b(salary|compensation|pay|base|equity|bonus|rate)\b|\$\s?\d`), "pay"},
	{regexp.MustCompile(`(?i)\b(start date|start|notice period|join)\b`), "start"},
	{regexp.MustCompile(`(?i)\b(availab|relocat|on-?site|in office|hybrid|hours)`), "availability"},
	{
		regexp.MustCompile(`(?i)\b(visa|sponsor|authori[sz]|citizen|permanent resident|` +
			`work permit)`),
		"authorization",
	},
}

// TopicsOf —— the topics a question raised, in a fixed order; the answer to it is then quoted
// whole. Read from the question, not the answer: an answer's wording ("happy to chat when you're
// available") would flag commitments nobody asked for.
func TopicsOf(question string) []string {
	out := []string{}
	for _, r := range topicRules {
		if r.re.MatchString(question) {
			out = append(out, r.topic)
		}
	}
	return out
}

// EngagementOf —— the exchanges, gaps counted.
func EngagementOf(ex []Exchange) Engagement {
	out := Engagement{Questions: ex}
	for i := range ex {
		if !ex[i].Grounded {
			out.Gaps++
		}
	}
	return out
}

// GapsOf —— ungrounded questions across applications, counted by question (case and spacing
// aside), first asked first.
func GapsOf(ex []Exchange) []Gap {
	out := []Gap{}
	index := map[string]int{}
	for i := range ex {
		if ex[i].Grounded {
			continue
		}
		key := QuestionKey(ex[i].Question)
		j, ok := index[key]
		if !ok {
			index[key] = len(out)
			out = append(out, Gap{Question: strings.TrimSpace(ex[i].Question)})
			j = len(out) - 1
		}
		out[j].Count++
		out[j].ApplicationIDs = appendOnce(out[j].ApplicationIDs, ex[i].ApplicationID)
	}
	return out
}

func appendOnce(ids []string, id string) []string {
	if slices.Contains(ids, id) {
		return ids
	}
	return append(ids, id)
}
