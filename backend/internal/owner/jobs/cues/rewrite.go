// rewrite.go —— what the interviewer meant, from what speech recognition heard. A live line
// comes with stutters, fillers, false starts, a sentence cut in two, and names heard as other
// words (owner, 2026-10-21: "除了accent还有stutter，你光靠stt技术肯定不行，绝对是要有个重写层的").
// The model rewrites the line; code then refuses a rewrite that brings in a name nothing in the
// line sounds like — the first rewrite tried turned noise into names ("Coopatavi" → Kubernetes).

package cues

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
)

const (
	// rewriteContext —— the other side's earlier lines the rewrite sees (a cut sentence's head).
	rewriteContext = 2
	// rewriteSlack —— how many words a rewrite may add (joining a cut sentence adds none).
	rewriteSlack = 3
)

var (
	jsonObjectRE = regexp.MustCompile(`(?s)\{.*\}`)
	digitsRE     = regexp.MustCompile(`\d+`)
)

// Heard —— the line as heard and as meant; Refused says why the rewrite was not used.
type Heard struct {
	Raw      string `json:"heard"`
	Question string `json:"question"`
	Refused  string `json:"refused,omitempty"`
}

// toRewrite —— one line to rewrite: the provider it runs on, the names it may restore, and the
// other side's earlier lines.
type toRewrite struct {
	provider string
	line     string
	names    []string
	earlier  []string
}

func rewritePrompt(names, earlier []string) string {
	prev := "(none)"
	if len(earlier) > 0 {
		prev = "- " + strings.Join(earlier, "\n- ")
	}
	return "You turn a live speech-recognition transcript of what an interviewer just said " +
		"into the words they meant.\n" +
		"- Remove fillers (um, uh, like, you know, I mean), stutters, repeated words and false " +
		"starts: keep only the last version of a phrase the speaker restarted.\n" +
		"- If the line continues the interviewer's previous line (it starts mid-sentence), " +
		"join the two into one question.\n" +
		"- Fix a word only when it is clearly a mis-hearing of one of these names: " +
		strings.Join(names, ", ") + ". Never bring in any other name, number or fact.\n" +
		"- Do not answer. Do not add what the speaker did not say. If the line is not " +
		"intelligible, return it unchanged.\n\n" +
		"The interviewer's previous lines, oldest first:\n" + prev + "\n\n" +
		`Reply with JSON only: {"question":"..."}`
}

// rewrite —— the line as meant. Any failure (the model, its JSON, the guard) keeps the line as
// heard: a rewrite can only help, never cost the card.
func (a *Assistant) rewrite(ctx context.Context, ownerID string, r *toRewrite) Heard {
	h := Heard{Raw: r.line, Question: r.line}
	req := ModelRequest{
		System:   rewritePrompt(r.names, r.earlier),
		Messages: []Message{{Role: "user", Content: r.line}},
	}
	_, out, err := a.ports.Model(ctx, ownerID, r.provider, req, func(string) {})
	if err != nil {
		h.Refused = "model: " + err.Error()
		return h
	}
	var got struct {
		Question string `json:"question"`
	}
	if jerr := json.Unmarshal([]byte(jsonObjectRE.FindString(out)), &got); jerr != nil ||
		strings.TrimSpace(got.Question) == "" {
		h.Refused = "no question in the reply"
		return h
	}
	said := strings.Join(append(append([]string{}, r.earlier...), r.line), " ")
	if why := guard(got.Question, said, r.names); why != "" {
		h.Refused = why
		return h
	}
	h.Question = strings.TrimSpace(got.Question)
	return h
}

// guard —— why a rewrite cannot be trusted, or "": it may not bring in a name no heard word
// sounds like, a number nobody said, or a pile of words nobody said.
func guard(question, said string, names []string) string {
	if why := newName(question, said, names); why != "" {
		return why
	}
	for _, d := range digitsRE.FindAllString(question, -1) {
		if !strings.Contains(said, d) {
			return "brings in the number " + d
		}
	}
	if len(words(question)) > len(words(said))+rewriteSlack {
		return "adds words nobody said"
	}
	return ""
}

// newName —— a name of the owner's in the rewrite that was not said and that no heard word sounds
// like, as the reason to refuse; "" when every name is accounted for.
func newName(question, said string, names []string) string {
	heard := words(said)
	low := strings.ToLower(said)
	for _, n := range names {
		re := regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(n) + `\b`)
		if !re.MatchString(question) || strings.Contains(low, strings.ToLower(n)) {
			continue
		}
		if !soundsLike(heard, n) {
			return "brings in " + n + ", which nothing heard sounds like"
		}
	}
	return ""
}
