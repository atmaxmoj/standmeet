// classify.go —— the follow-up classifier (follow-up 链 spec §1). It runs between a question's
// arrival and the cue pipeline, and outputs METADATA ONLY: it never rewrites the question and never
// writes into the card. It is deliberately NOT the card-writing model (the judge is not a party).
//
// Decision order:
//  1. empty chain → nothing to follow up.
//  2. explicit back-reference ("you just said …") → follow-up, rule fast-path, no model call.
//  3. bare referential ("why?", "那 70 秒呢？") — no independent content, only readable against the
//     prior line → follow-up, rule fast-path.
//  4. otherwise ask the injected model (nil = skip); a yes is a follow-up.
//  5. fail closed: still unsure → NOT a follow-up. The costs are asymmetric — calling a new
//     question a follow-up washes project notes into a generic answer (the dangerous direction),
//     while calling a follow-up new just falls back to a generic card (safe). §3's hard gate.
//
// A follow-up inherits the anchor chain's named projects (§2) so citedFrom can ground them — unless
// the question is a pivot (refers back only to turn away), which links but inherits nothing.

package cues

import (
	_ "embed"
	"regexp"
	"strings"
)

// ChainTurn —— one earlier user turn as the classifier sees it: its id, its text, and the projects
// it named (carried on the call so the chain's project resolve is available without re-running it).
type ChainTurn struct {
	ID            string
	Text          string
	NamedProjects []string
}

// Classification —— the classifier's output, logged for audit and golden-set scoring. It changes no
// text; the pipeline reads InheritedProjects to widen citedFrom's named set.
type Classification struct {
	AnchorTurnID      string
	ReferredClaim     string
	Reason            string
	InheritedProjects []string
	FollowUp          bool
}

// ClassifierModel —— the small model consulted only for the ambiguous path (§1 "含糊的才上模型").
// nil = deterministic only, which still resolves safely by failing closed.
type ClassifierModel func(prior []ChainTurn, question string) (followUp bool, reason string)

// markerPatterns —— the follow-up marker regexes (EN + ZH), in a data file so the server source
// carries no non-Latin string literals (gosmopolitan), the same way terms.tsv holds the glossary.
// Keys: "explicit" (a stated back-reference), "bare" (a whole question with no independent content,
// e.g. "why?" / "那 X 呢"), "pivot" (refers back only to change the subject).
//
//go:embed classify_markers.tsv
var markerPatterns string

var markers = compileMarkers(markerPatterns)

func compileMarkers(tsv string) map[string]*regexp.Regexp {
	out := map[string]*regexp.Regexp{}
	for line := range strings.SplitSeq(tsv, "\n") {
		key, pat, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if ok && key != "" {
			out[key] = regexp.MustCompile(pat)
		}
	}
	return out
}

// classify —— the classification for one new question against the call so far.
func classify(prior []ChainTurn, question string, model ClassifierModel) Classification {
	if len(prior) == 0 {
		return Classification{Reason: "no prior turns"}
	}
	q := strings.TrimSpace(question)
	if reason, ok := ruleFollowUp(q); ok {
		return followUpOf(prior, q, reason)
	}
	if model != nil {
		if fu, reason := model(prior, q); fu {
			return followUpOf(prior, q, "model: "+reason)
		}
	}
	return Classification{Reason: "fail-closed: not a follow-up"}
}

// ruleFollowUp —— the no-model fast path: an explicit back-reference or a bare referential question
// is a follow-up by rule. Anything else returns false (the model, then fail-closed, decide).
func ruleFollowUp(q string) (string, bool) {
	switch {
	case markers["explicit"].MatchString(q):
		return "explicit back-reference", true
	case markers["bare"].MatchString(q):
		return "bare referential", true
	default:
		return "", false
	}
}

// followUpOf —— a follow-up anchored at the most recent turn. It inherits the chain's named
// projects (§2) unless the question is a pivot.
func followUpOf(prior []ChainTurn, q, reason string) Classification {
	anchor := prior[len(prior)-1]
	c := Classification{FollowUp: true, AnchorTurnID: anchor.ID, Reason: reason}
	if markers["pivot"].MatchString(q) {
		c.Reason = reason + "; pivot (no inheritance)"
		return c
	}
	c.InheritedProjects = chainProjects(prior)
	return c
}

// classifierSystem —— the small model's whole job: one word, and bias to NO (fail closed, §3).
const classifierSystem = "You label one interview question. Decide if the NEW QUESTION is a " +
	"follow-up to the prior turns: it refers back to something already said (explicitly, or a " +
	"bare reference that only makes sense against the prior line) and should inherit that topic. " +
	"A question that moves to a NEW topic — even in the same interview — is not a follow-up. " +
	"Answer with exactly one word, YES or NO. When unsure, answer NO."

// classifierMessages —— the prior turns and the new question, as one user message for the model.
func classifierMessages(prior []ChainTurn, question string) []Message {
	var b strings.Builder
	b.WriteString("PRIOR TURNS (oldest first):\n")
	for i := range prior {
		b.WriteString("- ")
		b.WriteString(prior[i].Text)
		b.WriteString("\n")
	}
	b.WriteString("\nNEW QUESTION:\n")
	b.WriteString(question)
	b.WriteString("\n\nIs the NEW QUESTION a follow-up? Answer YES or NO.")
	return []Message{{Role: "user", Content: b.String()}}
}

var classifierYesRE = regexp.MustCompile(`(?i)\byes\b`)

// parseFollowUp —— YES anywhere → follow-up; anything else (incl. a refusal or empty) → not, the
// fail-closed default.
func parseFollowUp(text string) (bool, string) {
	if classifierYesRE.MatchString(text) {
		return true, "model: yes"
	}
	return false, "model: no"
}

// chainProjects —— every project named along the chain, first-appearance order, deduped.
func chainProjects(prior []ChainTurn) []string {
	seen := map[string]bool{}
	out := []string{}
	for i := range prior {
		for _, p := range prior[i].NamedProjects {
			if !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	return out
}
