// agent_product_test.go —— deterministic guard for the F-A-4 P1 rule: text streamed in a
// round that ends WITH tool calls is process (planning narration), never the answer. Only
// tool-less tails (incl. the forced-final synthesis) are product. The rule is mechanical
// (gates-are-necessary-conditions: every successful turn's real answer is the tool-less
// tail), so this is the α≈0 unit tier — no LLM, no network.

package inference

import (
	"encoding/json"
	"testing"
)

// TestTurnStateProductClassification —— loop-side: narration rounds drop, answer commits.
func TestTurnStateProductClassification(t *testing.T) {
	t.Parallel()
	state := &turnState{}

	// Round 1: "Let me survey…" then tool calls → process.
	state.roundText = "Let me survey the corpus."
	state.assistantText = state.roundText
	discardRoundText(state)
	if state.product != "" {
		t.Fatalf("narration round leaked into product: %q", state.product)
	}

	// Round 2: more narration + tools → process.
	state.roundText = "Let me dig into the specifics."
	discardRoundText(state)

	// Final round: no tool calls → product.
	state.roundText = "Here is the actual synthesized answer."
	commitRoundText(state)
	if state.product != "Here is the actual synthesized answer." {
		t.Fatalf("product wrong: %q", state.product)
	}
	if state.roundText != "" {
		t.Fatalf("roundText not flushed: %q", state.roundText)
	}
}

// nullSink —— a no-op inner sink for accumSink tests.
type nullSink struct{}

func (nullSink) Text(string)                                   {}
func (nullSink) ToolStarted(_, _, _ string, _ json.RawMessage) {}
func (nullSink) ToolCompleted(string, string)                  {}
func (nullSink) Epilogue(*EpilogueFrame)                       {}
func (nullSink) Retrying(int)                                  {}
func (nullSink) Error(error)                                   {}
func (nullSink) Done(string)                                   {}

// TestAccumSinkAnswerIsProductOnly —— persistence-side: the durable answer excludes the
// narration segments; only the tool-less tail lands in TurnResult.Answer.
func TestAccumSinkAnswerIsProductOnly(t *testing.T) {
	t.Parallel()
	a := newAccumSink(nullSink{})

	a.Text("Let me survey the corpus.")
	a.ToolStarted("t1", "corpus_search", "", json.RawMessage(`{}`))
	a.ToolCompleted("corpus_search", `{"ok":true}`)

	a.Text("Let me read the hubs.")
	a.ToolStarted("t2", "corpus_read", "", json.RawMessage(`{}`))
	a.ToolCompleted("corpus_read", `{"ok":true,"id":"w1","genre":"wiki","show_as_source":true}`)

	a.Text("The real answer, synthesized.")
	a.Done("end_turn")

	res := a.result("q")
	if res.Answer != "The real answer, synthesized." {
		t.Fatalf("persisted answer must be product-only, got: %q", res.Answer)
	}
	if !a.answered() {
		t.Fatal("answered() must be true when a product tail exists")
	}
}

// TestAccumSinkNarrationOnlyIsNotAnAnswer —— a turn that streamed ONLY narration (every
// segment ended in tool calls, no synthesis) has no answer — it must not persist a dialog
// whose answer is planning narration (the original F-A-4 transcript shape).
func TestAccumSinkNarrationOnlyIsNotAnAnswer(t *testing.T) {
	t.Parallel()
	a := newAccumSink(nullSink{})

	a.Text("Let me survey the corpus.")
	a.ToolStarted("t1", "corpus_search", "", json.RawMessage(`{}`))
	a.Text("Let me dig further.")
	a.ToolStarted("t2", "corpus_search", "", json.RawMessage(`{}`))
	a.Done("end_turn")

	if a.answered() {
		t.Fatalf("narration-only turn must not count as answered; answer=%q",
			a.result("q").Answer)
	}
}
