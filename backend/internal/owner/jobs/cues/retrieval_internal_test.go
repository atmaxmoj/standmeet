// retrieval_test.go —— pure, PII-free tests of what the cue deck grounds a card on, against the
// synthetic persona (synthpersona_test.go). No model, no live instance, no owner data.
//
// Covers the retrieval-side rules of the 2026-10-22 cue specs:
//   - cue-resume-binding R2 / cue-layered-grounding H1: the owner's own résumé/CV leads.
//   - cue-gap-discipline G3: a do-not-lead note enters only when the question names its topic.

package cues

import (
	"slices"
	"testing"
)

func sourcesFor(notes []Note, query string) []string {
	return NewDeck(notes, "").build(query, RoundByID(""), "").sources
}

func contains(ss []string, want string) bool { return slices.Contains(ss, want) }

// TestResumeLeadsBackground —— a background / fit question grounds on the CV (subjectivity), and it
// leads (cue-resume-binding R2, cue-layered-grounding H1). Before the subjectivity layer, a short
// CV was crowded out of the six global BM25 slots by denser project/methodology notes.
func TestResumeLeadsBackground(t *testing.T) {
	t.Parallel()
	got := sourcesFor(synthNotes(), "walk me through your background and why this role")
	if !contains(got, "cv") {
		t.Fatalf("background question did not ground on the CV; sources=%v", got)
	}
	if got[0] != "cv" {
		t.Fatalf("the CV should lead a background answer; sources=%v", got)
	}
}

// TestDoNotLeadStaysOutOfUnrelatedCard —— a note the owner tagged do-not-lead must not be pulled
// into an unrelated question's card by a shared keyword (cue-gap-discipline G3).
func TestDoNotLeadStaysOutOfUnrelatedCard(t *testing.T) {
	t.Parallel()
	notes := withDoNotLead(synthNotes(), "software/project/tideline")
	// An unrelated question (model serving) shares "pipeline"-adjacent words with Tideline but does
	// not name it.
	got := sourcesFor(notes, "how do you keep a model-serving endpoint within its latency budget")
	if contains(got, "software/project/tideline") {
		t.Fatalf("do-not-lead note leaked into an unrelated card; sources=%v", got)
	}
}

// TestDoNotLeadEntersWhenNamed —— the same do-not-lead note DOES enter when the question names its
// topic, so the marking suppresses keyword drag without hiding the material when asked (G3).
func TestDoNotLeadEntersWhenNamed(t *testing.T) {
	t.Parallel()
	notes := withDoNotLead(synthNotes(), "software/project/tideline")
	got := sourcesFor(notes, "tell me about Tideline")
	if !contains(got, "software/project/tideline") {
		t.Fatalf("do-not-lead note should enter when its topic is named; sources=%v", got)
	}
}

// TestNamedProjectGate —— when a question names one project, notes from a DIFFERENT project do not
// enter the card even if they share a generic word (cue-defect-loop F1/F4, cue-gap-discipline G2).
func TestNamedProjectGate(t *testing.T) {
	t.Parallel()
	// Names Larkspur; shares only the generic word "detection" with Harborpay's note.
	got := sourcesFor(synthNotes(), "At Larkspur what detection accuracy did your model hit")
	if contains(got, "software/project/harborpay") {
		t.Fatalf("a Harborpay note entered a Larkspur question via a shared word; sources=%v", got)
	}
	// A question that names no project is not gated — Harborpay can still surface when apt.
	open := sourcesFor(synthNotes(), "tell me about a fraud detection system you built")
	if !contains(open, "software/project/harborpay") {
		t.Fatalf("un-named question should still reach Harborpay; sources=%v", open)
	}
}

// withDoNotLead —— a copy of notes with the do-not-lead tag added to the note at path.
func withDoNotLead(notes []Note, path string) []Note {
	out := make([]Note, len(notes))
	copy(out, notes)
	for i := range out {
		if out[i].Path == path && !slices.Contains(out[i].Tags, doNotLeadTag) {
			out[i].Tags = append(slices.Clone(out[i].Tags), doNotLeadTag)
		}
	}
	return out
}

// TestDirectlyNames —— the salience admission test keys on distinctive title words, not stopwords.
func TestDirectlyNames(t *testing.T) {
	t.Parallel()
	cases := []struct {
		query, title string
		want         bool
	}{
		{"tell me about Tideline", "Tideline", true},
		{"how do you serve a model", "Tideline", false},
		{"what about the data pipeline", "Tideline data pipeline", true},
		{"and how does that work", "Tideline", false}, // only stopwords shared
	}
	for _, c := range cases {
		if got := directlyNames(c.query, c.title); got != c.want {
			t.Errorf("directlyNames(%q,%q)=%v want %v", c.query, c.title, got, c.want)
		}
	}
}
