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
	// The owner sees the FINISHED card: the server-enforced two states (finalize). Judge and checks
	// run on that, as production ships it; every card must be generic (marker) XOR grounded (From).
	fin := finalize(out, &cueCtx{
		sources: b.sources, namedProjects: b.namedProjects, posting: b.posting(),
		question: c.question,
	})
	t.Logf("\n--- Q: %s\n--- RAW MODEL:\n%s\n--- FINISHED CARD (%s):\n%s\n",
		c.question, out, fin.mode, fin.card)
	fails := c.check(fin.card)
	if two := twoStateFail(fin.card); two != "" {
		fails = append(fails, two)
	}
	if c.judge != "" {
		if ok, why := judge(t, grader, c.question, fin.card, c.judge); !ok {
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

// twoStateFail —— the acceptance follow-up #2 invariant: a finished card is EITHER generic (the
// general marker, no From) OR grounded (a From, no marker), never the gray third state (neither).
func twoStateFail(card string) string {
	marker := strings.Contains(card, "not from your notes")
	from := strings.Contains(card, "_From:")
	if marker && from {
		return "card is both generic (marker) and grounded (From)"
	}
	if !marker && !from {
		return "gray card: neither a general marker nor a From (the forbidden third state)"
	}
	return ""
}

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
