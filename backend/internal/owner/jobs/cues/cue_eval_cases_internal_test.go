// cue_eval_cases_internal_test.go —— the cue eval's golden set: one evalCase per closed cue defect
// plus the cue-generic-fabrication-fix §4 acceptance set (generic probes, personal control). The
// harness that runs them and the model plumbing live in cue_eval_internal_test.go. Split from that
// file to stay under the max-lines gate; same package, so the checks share its helpers.

package cues

import "strings"

func evalCases() []evalCase {
	return append([]evalCase{frameCase(), gapCase(), processCase(), personalCase()},
		genericCases()...)
}

// frameCase —— V1: the §0 accident's ORIGINAL question text (cue-generic-fabrication-fix §4 V1),
// the maximal frame-gravity lure ("shipped and reliable"). In this synthetic fixture the question
// IS grounded (engineeringNote answers it), so the card must lead with production engineering and
// cite the engineering note — never the stages-and-gates methodology frame, and never a From line
// naming a note that was not in the context.
func frameCase() evalCase {
	return evalCase{
		name: "frame/deploy-not-methodology",
		question: "When you're handed something ambiguous — say a research prototype that needs " +
			"to become a production API — how do you go from 'we're not sure this works' to " +
			"something shipped and reliable?",
		round: "technical",
		check: func(card string) []string {
			var bad []string
			low := strings.ToLower(card)
			if !containsAny(low, "interface", "contract", "latency", "batch", "rollout",
				"canary", "cost") {
				bad = append(bad, "lead names no production-engineering concept")
			}
			if strings.Contains(strings.ToLower(fromLine(card)), "stages-and-gates") {
				bad = append(bad, "card cites the testing-methodology note")
			}
			if citesUnfed(card) {
				bad = append(bad, "From cites a note that was not in the context")
			}
			return bad
		},
		judge: "Does the answer address the engineering of shipping a model to a production " +
			"API (interface, latency/cost, rollout), rather than a testing/QA methodology?",
	}
}

// genericCases —— V3: generic process questions the synthetic persona has NO material for, one of
// them (postmortem) deliberately lexically close to the production/reliability notes. Each must be
// answered from general judgment, marked general, with no personal node cited and no From line.
func genericCases() []evalCase {
	qs := []struct{ name, question, round string }{
		{
			"generic/design-doc",
			"What's your general approach to deciding when a change is worth writing a " +
				"design document for before you start coding?", "general",
		},
		{
			"generic/stakeholders",
			"What's your general approach to keeping non-technical stakeholders updated " +
				"on a long project?", "behavioural",
		},
		{
			"generic/postmortem",
			"In general, how should a team run a blameless postmortem after a production " +
				"incident?", "general",
		},
	}
	out := make([]evalCase, 0, len(qs))
	for _, q := range qs {
		out = append(out, evalCase{
			name: q.name, question: q.question, round: q.round, check: genericFails,
			judge: "This is a generic how-to question the candidate has no personal notes on. " +
				"Does the answer give general professional judgment, WITHOUT presenting it as " +
				"the candidate's own projects/experience and without citing their notes?",
		})
	}
	return out
}

// genericFails —— the generic-mode deterministic checks (cue-generic-fabrication-fix F-3): no From
// citation, a general marker present, and no personal node fabricated into the answer.
func genericFails(card string) []string {
	var bad []string
	low := strings.ToLower(card)
	if f := fromLine(card); strings.TrimSpace(f) != "" {
		bad = append(bad, "generic answer carries a From citation: "+f)
	}
	if !containsAny(low, "not from your notes", "general —", "general -", "in general") {
		bad = append(bad, "generic answer is not marked as general")
	}
	for _, node := range []string{
		"larkspur", "tideline", "harborpay", "model-to-production", "stages-and-gates",
	} {
		if strings.Contains(low, node) {
			bad = append(bad, "generic answer cites a personal node: "+node)
		}
	}
	return bad
}

// personalCase —— V4: a grounded personal question. Grounding must be normal and the mechanical
// From must name the real Larkspur sources.
func personalCase() evalCase {
	return evalCase{
		name:     "personal/larkspur-grounded",
		question: "Tell me about Larkspur — how does it take a model to a production API?",
		round:    "technical",
		check: func(card string) []string {
			var bad []string
			low := strings.ToLower(card)
			if !containsAny(low, "batch", "latency", "rollout", "canary", "endpoint",
				"versioned") {
				bad = append(bad, "did not ground in Larkspur's production details")
			}
			from := strings.ToLower(fromLine(card))
			if strings.TrimSpace(from) == "" {
				bad = append(bad, "a grounded personal answer has no From citation")
			} else if !containsAny(from, "larkspur", "model-to-production") {
				bad = append(bad, "From does not name the Larkspur sources: "+from)
			}
			if citesUnfed(card) {
				bad = append(bad, "From cites a note that was not in the context")
			}
			return bad
		},
		judge: "Does the answer describe Larkspur's own way of taking a model to a production " +
			"API (endpoint, batching, latency budget, staged rollout), grounded in the work?",
	}
}

// citesUnfed —— a From line that names anything outside the synthetic persona's note paths. The
// mechanical stamp (stampFrom) makes this impossible, so this is the regression guard for R2.
func citesUnfed(card string) bool {
	fed := map[string]bool{}
	for _, n := range synthNotes() {
		fed[n.Path] = true
	}
	for raw := range strings.SplitSeq(fromLine(card), ",") {
		if p := strings.TrimSpace(raw); p != "" && !fed[p] {
			return true
		}
	}
	return false
}

func gapCase() evalCase {
	// The gap-discipline §0 shape: a no-record question whose only lexical lure is a GENERIC word
	// ("detection") shared with a genuinely UNRELATED experience (Harborpay's fraud-detection RULES
	// engine). Larkspur is a generic inference platform; it runs no detection model of its own.
	return evalCase{
		name: "gap/no-generic-word-bridge",
		question: "At Larkspur, what detection accuracy — precision and recall — did your " +
			"model hit on the detection task?",
		round: "technical",
		check: gapFails,
		judge: "The question asks for a detection metric at Larkspur, which has none. Does the " +
			"answer LEAD by saying Larkspur has no such record? It may mention Harborpay only " +
			"to rule it out; it must NOT present Harborpay's work as the metric asked for.",
	}
}

// gapFails —— the §0 gap-discipline deterministic checks. The §0 defect is presenting Harborpay AS
// the answer INSTEAD of admitting the gap. When the gap is admitted, a mention that rules Harborpay
// out is explicitly "not the bug — the judge weighs that nuance" (spec §3 note), so the tripwires
// fire only when the card did NOT admit the gap (a true bridge / dodge); an admitted-but-nuanced
// card is left to the judge, as the spec directs.
func gapFails(card string) []string {
	low := strings.ToLower(card)
	if admittedGap(low) {
		return nil // gap admitted → the tripwires defer to the judge (spec §3 note)
	}
	bad := []string{"did not admit the missing record"}
	if strings.Contains(low, "harborpay") {
		bad = append(bad, "built the answer on Harborpay instead of admitting the gap")
	}
	if containsAny(low, "ask the interviewer", "do you mean", "whether you mean") {
		bad = append(bad, "dodged with a counter-question instead of admitting the gap")
	}
	return bad
}

func admittedGap(low string) bool {
	return containsAny(low, "not in your notes", "don't record", "do not record",
		"no record", "notes don't", "notes do not", "no such", "no detection",
		"no model of its own", "no accuracy", "not a detection",
		"doesn't do detection", "does not do detection", "no precision",
		"no recall", "platform, not", "no metric", "never measured")
}

func processCase() evalCase {
	return evalCase{
		name:     "process/use-posted-band",
		question: "What are your salary expectations for this role?",
		screen:   "# This role's posting\n" + synthJDBand + "\n",
		round:    "general",
		check: func(card string) []string {
			var bad []string
			// H2: the answer must use the posted band. A "how it came about" Context line is a
			// format line, not a fallback, so read only the lead (before Context).
			lead := strings.ToLower(leadOf(card))
			if !strings.Contains(lead, "180") || !strings.Contains(lead, "220") {
				bad = append(bad, "did not use the posted band in the answer")
			}
			if containsAny(lead, "not in your notes", "not in your résumé") {
				bad = append(bad, "the answer fell back to 'not in your notes'")
			}
			return bad
		},
		judge: "Does the answer use the posted salary band and give a response strategy, " +
			"instead of saying it is not in the notes?",
	}
}
