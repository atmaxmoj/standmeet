// thinking.go —— a model that thinks before it answers, unless the request turns thinking off.
//
// Claude 5.5 Haiku thinks by default, and its thinking tokens share max_tokens with the answer:
// the screen assistant's 800-token card came back as one thinking block and stop_reason
// max_tokens — no text at all (prod, 2026-10-20). A mock that always answers is politer than
// that ([[stand-in-is-politer-than-reality]]), so a test opts into the real behaviour:
//
//	[[thinks-first]]  —— in the request text: unless the request carries
//	                     "thinking":{"type":"disabled"}, the reply is one thinking block that
//	                     uses the whole budget, then stop_reason max_tokens, and no text.
package main

import "strings"

const thinksFirstMarker = "[[thinks-first]]"

// thinkingField —— the request's `thinking` object ({"type":"disabled"|"enabled"|"adaptive"}).
type thinkingField struct {
	Type string `json:"type"`
}

// thinksFirst —— this request gets the thinking-only reply.
func (r *MessagesReq) thinksFirst() bool {
	off := r.Thinking != nil && r.Thinking.Type == "disabled"
	return !off && strings.Contains(r.markerText(), thinksFirstMarker)
}

// emitThinkingOnly —— one thinking block, then the budget runs out.
func emitThinkingOnly(s *sseWriter) error {
	if err := s.send("content_block_start", map[string]any{
		"type": "content_block_start", "index": 0,
		"content_block": map[string]any{"type": "thinking", "thinking": ""},
	}); err != nil {
		return err
	}
	if err := s.send("content_block_delta", map[string]any{
		"type": "content_block_delta", "index": 0,
		"delta": map[string]any{"type": "thinking_delta", "thinking": "Let me weigh the notes first…"},
	}); err != nil {
		return err
	}
	if err := s.send("content_block_stop", map[string]any{
		"type": "content_block_stop", "index": 0,
	}); err != nil {
		return err
	}
	if err := emitMessageDelta(s, stopMaxTokens); err != nil {
		return err
	}
	return emitMessageStop(s)
}
