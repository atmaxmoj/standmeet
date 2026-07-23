package inference

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"
)

// persistSpy —— capture whether persistTurn invoked the injected PersistFunc, and with what.
func persistSpy(captured **TurnResult) PersistFunc {
	return func(_ context.Context, res *TurnResult) error {
		*captured = res
		return nil
	}
}

// TestPersistTurnFiresForReturnDirectly —— F-A-19: a return_directly tool (summarize / booking
// ask_visitor) ends the turn with its RESULT as the product (report card) and NO model answer
// text. The old rule "persist iff answered()" dropped the whole dialog, so after a reload the
// summarize question + report card vanished from the restored transcript (the visitor lost the
// report they generated). persistTurn must persist a turn that ran a return_directly tool even with
// an empty answer.
//
// RED before the fix: persistTurn's `!acc.answered()` guard skips this turn → captured stays nil.
func TestPersistTurnFiresForReturnDirectly(t *testing.T) {
	t.Parallel()

	acc := newAccumSink(nullSink{})
	acc.ToolStarted("t1", "summarize_conversation", "", json.RawMessage(`{}`))
	acc.ToolCompleted("summarize_conversation", `{"ok":true,"report_id":"r1"}`)
	acc.Done("tool_use")

	var captured *TurnResult
	in := &AgentTurnInput{
		Req:            &AgentTurnRequest{UserMessage: "Summarize our conversation so far"},
		ReturnDirectly: map[string]bool{"summarize_conversation": true},
		Persist:        persistSpy(&captured),
	}
	persistTurn(context.Background(), slog.Default(), in, acc)

	require.NotNil(t, captured,
		"the summarize (return_directly) dialog must persist so it survives a reload")
	require.Equal(t, "Summarize our conversation so far", captured.Question)
	require.NotEmpty(t, captured.ToolCalls,
		"the persisted dialog carries the summarize tool_call (the report)")
}

// TestPersistTurnSkipsNarrationOnly —— paired F-A-4 guard must hold: a narration-only turn
// whose only tools were GROUNDING (corpus_search) with no synthesis must NOT persist a dialog
// whose "answer" is planning narration. The discriminator is return_directly, not "any tool ran".
func TestPersistTurnSkipsNarrationOnly(t *testing.T) {
	t.Parallel()

	acc := newAccumSink(nullSink{})
	acc.Text("Let me survey the corpus.")
	acc.ToolStarted("t1", "corpus_search", "", json.RawMessage(`{}`))
	acc.ToolCompleted("corpus_search", `{"ok":true}`)
	acc.Done("end_turn")

	var captured *TurnResult
	in := &AgentTurnInput{
		Req:            &AgentTurnRequest{UserMessage: "tell me about X"},
		ReturnDirectly: map[string]bool{"summarize_conversation": true},
		Persist:        persistSpy(&captured),
	}
	persistTurn(context.Background(), slog.Default(), in, acc)

	require.Nil(t, captured,
		"a narration-only grounding turn (corpus_search, no answer) must NOT persist (F-A-4)")
}

// TestPersistTurnFiresForRealAnswer —— baseline: an ordinary answered turn still persists.
func TestPersistTurnFiresForRealAnswer(t *testing.T) {
	t.Parallel()

	acc := newAccumSink(nullSink{})
	acc.Text("The synthesized answer.")
	acc.Done("end_turn")

	var captured *TurnResult
	in := &AgentTurnInput{
		Req:     &AgentTurnRequest{UserMessage: "q"},
		Persist: persistSpy(&captured),
	}
	persistTurn(context.Background(), slog.Default(), in, acc)

	require.NotNil(t, captured, "an answered turn persists as before")
	require.Equal(t, "The synthesized answer.", captured.Answer)
}
