// cue_followup_eval_internal_test.go —— the follow-up chain regression (spec A §3), live-model
// gated behind CUE_EVAL=1 like TestCueEval.
//
// The 2026-10-28 bug: in a call, Q1 names the project and grounds, but 追问1 (a follow-up that
// does NOT re-name the project) comes back a `project_filtered` generic card — the project note
// the model used was dropped because the single question did not name the project. The fix: the
// classifier marks 追问1 a follow-up and inherits Q1's project, so citedFrom keeps that note.
//
// The gate finalizes ONE model answer two ways — with and without the inherited project — to show
// the inherited set is what turns a dropped project note into a grounded citation.

package cues

import (
	"os"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
)

func evalCardCred(t *testing.T) *inference.Cred {
	t.Helper()
	if os.Getenv("CUE_EVAL") != "1" {
		t.Skip("set CUE_EVAL=1 (+ provider env) to run the live follow-up eval")
	}
	ep := envOr("CUE_EVAL_ENDPOINT", os.Getenv("DEEPSEEK_ENDPOINT"))
	key := envOr("CUE_EVAL_KEY", os.Getenv("DEEPSEEK_KEY"))
	if ep == "" || key == "" {
		t.Fatal("set CUE_EVAL_ENDPOINT+CUE_EVAL_KEY (or DEEPSEEK_ENDPOINT+DEEPSEEK_KEY)")
	}
	return cred(envOr("CUE_EVAL_PROVIDER", "deepseek"), ep, key,
		envOr("CUE_EVAL_MODEL", "deepseek-chat"))
}

// evalClassifier —— a ClassifierModel backed by the real card model (the ambiguous path's judge).
func evalClassifier(t *testing.T, c *inference.Cred) ClassifierModel {
	t.Helper()
	return func(prior []ChainTurn, question string) (bool, string) {
		out := complete(t, c, classifierSystem, classifierMessages(prior, question)[0].Content)
		return parseFollowUp(out)
	}
}

func TestCueFollowUpChainRegression(t *testing.T) {
	t.Parallel()
	card := evalCardCred(t)
	round := RoundByID("technical")
	brief := "Senior Platform Engineer — shipping ML models to production APIs"

	// Q1 named the project; the follow-up refers back ("those rollouts") without re-naming it.
	chain := []ChainTurn{{
		ID:            "t1",
		Text:          "Walk me through Larkspur — how does it take a model to a production API?",
		NamedProjects: []string{"larkspur"},
	}}
	q2 := "And when one of those staged rollouts goes bad — what stops it reaching every tenant?"

	// 1. the classifier (real small model on the ambiguous path) must call it a follow-up that
	//    inherits larkspur — the §3 regression's first half.
	cl := classify(chain, q2, evalClassifier(t, card))
	t.Logf("classify: follow_up=%v anchor=%s inherited=%v reason=%q",
		cl.FollowUp, cl.AnchorTurnID, cl.InheritedProjects, cl.Reason)
	if !cl.FollowUp || !contains(cl.InheritedProjects, "larkspur") {
		t.Fatalf("追问 must classify as a follow-up inheriting larkspur; got %+v", cl)
	}

	// 2. finalize ONE model answer both ways.
	b := NewDeck(synthNotes(), brief).build(q2, round, "")
	out := complete(t, card, systemPrompt(b.context, round.closingRules()), q2)
	effective := unionProjects(b.namedProjects, cl.InheritedProjects)
	with := finalize(out, &cueCtx{
		sources: b.sources, namedProjects: effective, posting: b.posting(), question: q2,
	})
	without := finalize(out, &cueCtx{
		sources: b.sources, namedProjects: b.namedProjects, posting: b.posting(), question: q2,
	})
	t.Logf("--- 追问 RAW MODEL:\n%s\n--- WITH inheritance (%s, from=%v):\n%s\n--- WITHOUT (%s/%s)",
		out, with.mode, with.from, with.card, without.mode, without.downgrade)

	// 3. the gate: with the inherited project, a larkspur project note grounds the card.
	if with.mode != "grounded" {
		t.Fatalf("with inheritance 追问 must be grounded (got %s/%s):\n%s",
			with.mode, with.downgrade, with.card)
	}
	if !strings.Contains(strings.Join(with.from, ","), "larkspur") {
		t.Fatalf("grounded From should cite a larkspur note (inheritance kept it); got %v",
			with.from)
	}
}
