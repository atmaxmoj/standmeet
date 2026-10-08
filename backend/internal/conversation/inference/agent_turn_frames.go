// agent_turn_frames.go —— the pi SSE frame payloads sseSink (agent_turn.go) writes, and the one
// rule for what a tool result may show live.

package inference

import "encoding/json"

// shownResult —— what of this tool call's result goes out live: the caller's rule
// (AgentTurnInput.ShowToolResult — the visitor route injects conversation.VisitorToolResult,
// which closes F-A-28's live half: no raw retrieval text, a citable read keeps only its
// citation). No rule injected → unchanged (an owner-side or test caller).
func shownResult(show func(name, result string) string, name, result string) string {
	if show == nil {
		return result
	}
	return show(name, result)
}

type toolStartedPayload struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	ProgressLabel string          `json:"progress_label,omitempty"`
	Args          json.RawMessage `json:"args"`
}

type toolCompletedPayload struct {
	Name   string `json:"name"`
	Result string `json:"result"`
}

// retryingPayload —— payload of an SSE `retrying` frame. attempt is which retry (from 1).
type retryingPayload struct {
	Attempt int `json:"attempt"`
}
