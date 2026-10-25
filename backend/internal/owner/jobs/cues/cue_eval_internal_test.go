// cue_eval_internal_test.go —— the PII-FREE cue-card eval. It replaces the fork eval
// (cheating-daddy eval/cases.js), which ran against the owner's live instance and real vault. This
// one builds the real system prompt from the SYNTHETIC persona (synthpersona_internal_test.go),
// calls the real model, and judges each card against the cue-defect-loop §6 fit criteria. No owner
// data, no live instance.
//
// Gated behind CUE_EVAL=1 so a normal `go test` never calls a paid model. The provider is any
// anthropic-compatible one (deepseek default, or anthropic + claude-haiku). Run it with:
//
//	CUE_EVAL=1 CUE_EVAL_PROVIDER=anthropic CUE_EVAL_ENDPOINT=https://api.anthropic.com \
//	  CUE_EVAL_KEY=sk-ant-... CUE_EVAL_MODEL=claude-haiku-5-5 \
//	  CUE_EVAL_GRADER_MODEL=claude-sonnet-5-5 \
//	  go test ./internal/owner/jobs/cues/ -run TestCueEval -v
//
// It reads every card (owner's rule: "Eval 是需要你看日志输出的") and checks each card as the owner
// sees it (after the server stamps the From line, cue.go stampFrom), per the cue specs:
//
//	(a) 所指一致 — the lead answers the question's real subject (judge).
//	frame        — a deployment question is not framed as testing methodology (F1/F4; V1).
//	gap          — a no-record question admits the gap and does not bridge (G1/G2).
//	process      — a pay question uses the posted band, not "Not in your notes" (H2).
//	generic      — a no-material generic question is answered as general, no node cited (F-3; V3).
//	personal     — a grounded question keeps its mechanical From = real sources (F-2; V4).
//
// evalCases() IS the cue-defect-loop §5.2 golden set; the §8 ledger (one row per closed defect, the
// §2 schema) is persisted at docs/design/cue-defect-ledger.md. ONE case here per ledger row, each
// carrying that defect's original question verbatim and its §6 fit check.
// `frame` is the §0 incident (the stages-and-gates drift); `gap` and `process` are the sibling
// gap-discipline / layered-grounding incidents. L3 golden-set regression = run the whole set; it
// must stay all-green. When a new cue defect closes, add its original question here as a new case —
// that is how a reappearing drift toward one material cluster (§8) surfaces as a persistent red.
//
// Verified live 2026-10-25 against claude-haiku-5-5 (card + grader; the sk-ant-usr key in
// verify-creds authed directly): all seven cases pass judge + deterministic checks across four
// clean full-set runs. The §0 frame card leads with production engineering (interface/budgets/
// rollout), USED declares the real notes, and the server-stamped From equals those sources — the
// fabricated stages-and-gates frame and its forged From never return (cue-generic-fabrication-fix).

package cues

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/secret"
)

// cueEvalMaxTokens —— the card budget, matching the production cue model call.
const cueEvalMaxTokens = 800

type evalCase struct {
	check    func(card string) []string
	name     string
	question string
	screen   string // extra context the pipeline would carry (e.g. the posted JD band for H2)
	round    string
	judge    string // a yes/no the judge must answer "yes" to (§6a); "" skips it
}

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

func TestCueEval(t *testing.T) {
	t.Parallel()
	if os.Getenv("CUE_EVAL") != "1" {
		t.Skip("set CUE_EVAL=1 (+ provider env) to run the live cue eval")
	}
	// Any anthropic-compatible provider. Defaults are the owner's deepseek setup; the 2026-10-25
	// run used anthropic + claude-haiku-5-5 (CUE_EVAL_PROVIDER=anthropic, the sk-ant-usr key).
	provider := envOr("CUE_EVAL_PROVIDER", "deepseek")
	ep := envOr("CUE_EVAL_ENDPOINT", os.Getenv("DEEPSEEK_ENDPOINT"))
	key := envOr("CUE_EVAL_KEY", os.Getenv("DEEPSEEK_KEY"))
	if ep == "" || key == "" {
		t.Fatal("set CUE_EVAL_ENDPOINT+CUE_EVAL_KEY (or DEEPSEEK_ENDPOINT+DEEPSEEK_KEY)")
	}
	cardModel := envOr("CUE_EVAL_MODEL", "deepseek-chat")
	gradeModel := envOr("CUE_EVAL_GRADER_MODEL", envOr("DEEPSEEK_MODEL", "deepseek-v4-pro"))
	card := cred(provider, ep, key, cardModel)
	grader := cred(provider, ep, key, gradeModel)
	brief := "Senior Platform Engineer — shipping ML models to production APIs"
	for _, c := range evalCases() {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			runEvalCase(t, card, grader, brief, &c)
		})
	}
}

func runEvalCase(t *testing.T, card, grader *inference.Cred, brief string, c *evalCase) {
	t.Helper()
	round := RoundByID(c.round)
	b := NewDeck(synthNotes(), brief).build(c.question, round, c.screen)
	out := complete(t, card, systemPrompt(b.context, round.closingRules()), c.question)
	// The owner sees the FINISHED card: the model's USED line turned into the server's From line,
	// any model From stripped (stampFrom). Judge and checks run on that, as production ships it.
	finished := stampFrom(out, b.sources)
	t.Logf("\n--- Q: %s\n--- RAW MODEL:\n%s\n--- FINISHED CARD:\n%s\n", c.question, out, finished)
	fails := c.check(finished)
	if c.judge != "" {
		if ok, why := judge(t, grader, c.question, finished, c.judge); !ok {
			fails = append(fails, "judge: "+why)
		}
	}
	if len(fails) > 0 {
		t.Errorf("card failed §6 fit: %s", strings.Join(fails, "; "))
	}
}

// --- model plumbing (via the real inference path) ---

func cred(provider, endpoint, key, model string) *inference.Cred {
	return &inference.Cred{
		Provider: provider, Key: secret.New(key),
		Endpoint: strings.TrimRight(endpoint, "/"), Model: model,
	}
}

func complete(t *testing.T, c *inference.Cred, system, user string) string {
	t.Helper()
	req := &inference.ChatRequest{
		System:    system,
		Messages:  []inference.ChatRequestMsg{{Role: "user", Content: user}},
		MaxTokens: cueEvalMaxTokens,
	}
	text, err := inference.StreamText(context.Background(), c, req,
		inference.StreamOptions{NoThinking: true}, func(string) {})
	if err != nil {
		t.Fatalf("model call: %v", err)
	}
	return text
}

func judge(t *testing.T, c *inference.Cred, question, card, ask string) (bool, string) {
	t.Helper()
	sys := "You grade one interview cue card. The cue card below IS the candidate's answer to " +
		"the question — grade it as the answer, never say no answer was provided. Reply strictly " +
		"as JSON {\"pass\":bool,\"why\":string} and nothing else; be terse."
	user := "QUESTION:\n" + question + "\n\nTHE ANSWER (an interview cue card):\n" + card +
		"\n\nGRADE: " + ask
	out := complete(t, c, sys, user)
	var v struct {
		Why  string `json:"why"`
		Pass bool   `json:"pass"`
	}
	if j := jsonObject(out); j != "" && json.Unmarshal([]byte(j), &v) == nil {
		return v.Pass, v.Why
	}
	// A reply that is not clean JSON is inconclusive, not a pass. Surface what the judge said so
	// the reader (this is a read-the-output eval) sees why, instead of a blank reason.
	return false, "unparseable judge reply: " + strings.TrimSpace(out)
}

// leadOf —— the answer portion of a card: before the "Context", "_From:" and "Supplementary"
// sections, where a "notes don't say how this came about" line legitimately lives.
func leadOf(card string) string {
	lead := card
	for _, marker := range []string{"**Context", "_From:", "**Supplementary"} {
		if i := strings.Index(lead, marker); i >= 0 {
			lead = lead[:i]
		}
	}
	return lead
}

var jsonObjRE = regexp.MustCompile(`(?s)\{.*\}`)

func jsonObject(s string) string { return jsonObjRE.FindString(s) }

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
