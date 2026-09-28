// agent_turn_frames.go —— the pi SSE frame payloads sseSink (agent_turn.go) writes, and the one
// rule for what a tool result may show live.

package inference

import "encoding/json"

// shownResult —— can this tool call's result go out live, unchanged.
//
// **Right now it goes out unchanged — the half of F-A-28 still not closed.** The retrieval
// result contains note body text (including private subjectivity); the persistence path already
// strips it (history.go goes through VisitorToolCalls), the live path has not.
//
// Can't just strip it here: **the visitor's citation footnotes are computed by the frontend
// from these results.** Stripping result would make the footer disappear entirely
// (visitor-chat-tool-cards would go red immediately). So the show_as_source gate the design
// relies on is really a browser-side filter over a payload that already contains private body
// text — the server sends everything, the client decides what to display.
//
// To close this half, the server needs to emit citations as their own frame (already computed,
// right there in history's return value), so the footer stops depending on raw result. That's a
// streaming-protocol change, not an `if` added here.
func shownResult(_, result string) string {
	return result
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
