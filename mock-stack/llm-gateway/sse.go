// sse.go —— Anthropic-shape SSE emitters.
//
// Wire format matches backend/internal/inference/anthropic_sse.go parser:
//
//   event: message_start
//   data: {"type":"message_start", ...}\n\n
//
// Each event has `event:` line, `data:` line, blank line.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

type sseWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func newSSE(w http.ResponseWriter) (*sseWriter, error) {
	fl, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("response writer not flushable")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	return &sseWriter{w: w, flusher: fl}, nil
}

func (s *sseWriter) send(event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("sse marshal: %w", err)
	}
	if _, werr := fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, body); werr != nil {
		return fmt.Errorf("sse write: %w", werr)
	}
	s.flusher.Flush()
	return nil
}

func emitMessageStart(s *sseWriter, model string) error {
	return s.send("message_start", map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id":            "msg_mock_1",
			"type":          "message",
			"role":          "assistant",
			"content":       []any{},
			"model":         model,
			"stop_reason":   nil,
			"stop_sequence": nil,
			"usage": map[string]int{
				"input_tokens": 1, "output_tokens": 1,
			},
		},
	})
}

func emitTextBlock(s *sseWriter, index int, text string) error {
	if err := s.send("content_block_start", map[string]any{
		"type": "content_block_start", "index": index,
		"content_block": map[string]any{"type": "text", "text": ""},
	}); err != nil {
		return err
	}
	if err := s.send("content_block_delta", map[string]any{
		"type": "content_block_delta", "index": index,
		"delta": map[string]any{"type": "text_delta", "text": text},
	}); err != nil {
		return err
	}
	return s.send("content_block_stop", map[string]any{
		"type": "content_block_stop", "index": index,
	})
}

func emitToolUseBlock(
	s *sseWriter, index int, id, name string, input json.RawMessage,
) error {
	if err := s.send("content_block_start", map[string]any{
		"type": "content_block_start", "index": index,
		"content_block": map[string]any{
			"type": "tool_use", "id": id, "name": name, "input": map[string]any{},
		},
	}); err != nil {
		return err
	}
	if err := s.send("content_block_delta", map[string]any{
		"type": "content_block_delta", "index": index,
		"delta": map[string]any{
			"type": "input_json_delta", "partial_json": string(input),
		},
	}); err != nil {
		return err
	}
	return s.send("content_block_stop", map[string]any{
		"type": "content_block_stop", "index": index,
	})
}

func emitMessageDelta(s *sseWriter, stopReason string) error {
	return s.send("message_delta", map[string]any{
		"type": "message_delta",
		"delta": map[string]any{
			"stop_reason": stopReason, "stop_sequence": nil,
		},
		"usage": map[string]int{"output_tokens": 1},
	})
}

func emitMessageStop(s *sseWriter) error {
	return s.send("message_stop", map[string]any{"type": "message_stop"})
}
