// wire.go —— Anthropic Messages API request/response shapes.
//
// Subset of https://docs.anthropic.com/en/api/messages. We only decode
// the fields backend's AnthropicProvider sends (model/system/messages/
// tools/max_tokens/stream) and emit SSE matching what its parser
// (anthropic_sse.go) consumes.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Block —— content_block. text / tool_use / tool_result variants share
// the same struct; per-type fields are optional.
type Block struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   json.RawMessage `json:"content,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
}

// Msg —— role + ordered content blocks.
type Msg struct {
	Role    string  `json:"role"`
	Content []Block `json:"content"`
}

// ToolDef —— tool spec sent to the model.
type ToolDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// MessagesReq —— what backend POSTs to /v1/messages.
type MessagesReq struct {
	Model     string      `json:"model"`
	System    SystemField `json:"system,omitempty"`
	Messages  []Msg       `json:"messages"`
	Tools     []ToolDef   `json:"tools,omitempty"`
	MaxTokens int         `json:"max_tokens"`
	Stream    bool        `json:"stream"`
}

// SystemField —— Anthropic /v1/messages accepts two shapes of system:
//
//	"system": "..."                                   // simple string
//	"system": [{"type":"text","text":"..."}]          // prompt-cache blocks
//
// The eino claude adapter takes the block path; our backend byte-proxy still sends a
// plain string. We parse both and flatten to a single Text() string interface downstream.
type SystemField struct {
	Text string
}

func (s *SystemField) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	if b[0] == '"' {
		return json.Unmarshal(b, &s.Text)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(b, &blocks); err != nil {
		return fmt.Errorf("system: not string or block array: %w", err)
	}
	var sb strings.Builder
	for i := range blocks {
		if blocks[i].Type == "text" {
			sb.WriteString(blocks[i].Text)
		}
	}
	s.Text = sb.String()
	return nil
}

func (s SystemField) MarshalJSON() ([]byte, error) {
	if s.Text == "" {
		return []byte(`""`), nil
	}
	return json.Marshal(s.Text)
}

// markerText —— concatenates the text blocks of every message, for the delayed marker
// scan to use. The marker lives in the visitor's question (an early user text block);
// every /v1/messages call within a turn carries the full message history, so scanning
// the whole thing on any call — search/read/final — finds it (unlike questionText,
// which only looks at the window head and, on call 3, the window might not include the
// question anymore).
// **system counts too**: Anthropic's wire lifts system out to a separate field
// alongside messages, but the question "did this text reach the model's context" does
// not care which field it landed in. Without this line, the recorder's `?contains=`
// would answer false for anything that only went through system — a recorder that
// can't see half the request would make "the product didn't do it" and "the recorder
// didn't look" indistinguishable ([[gate-can-go-blind]]).
func (r *MessagesReq) markerText() string {
	var b strings.Builder
	b.WriteString(r.System.Text)
	b.WriteString(" ")
	for i := range r.Messages {
		b.WriteString(joinTextBlocks(r.Messages[i].Content))
		b.WriteString(" ")
	}
	return b.String()
}

func joinTextBlocks(blocks []Block) string {
	out := ""
	for i := range blocks {
		if blocks[i].Type == "text" {
			out += blocks[i].Text
		}
	}
	return out
}

// messagesSinceLastUser —— window starting at the most recent user
// message whose content carries a `text` block (the visitor's actual
// question). Tool_result user messages are NOT real questions in the
// Anthropic protocol — they live under user role but represent the
// previous assistant tool_use's reply.
//
// Without this, multi-iteration agent loops (search → result → search
// again) would have `hasToolResult` consider only the very last user
// message (a tool_result) and miss the assistant tool_use right above
// it, looping forever.
func (r *MessagesReq) messagesSinceLastUser() []Msg {
	for i := len(r.Messages) - 1; i >= 0; i-- {
		if r.Messages[i].Role == "user" && hasTextBlock(r.Messages[i].Content) {
			return r.Messages[i:]
		}
	}
	return r.Messages
}

func hasTextBlock(blocks []Block) bool {
	for i := range blocks {
		if blocks[i].Type == "text" {
			return true
		}
	}
	return false
}

// hasToolResult —— whether a tool_result for tool <name> appears in
// the current-turn window. pi-agent-core sends Anthropic-shape typed
// blocks now: assistant messages carry tool_use blocks (id, name) and
// user messages carry tool_result blocks (tool_use_id, content). We
// pair by id.
func (r *MessagesReq) hasToolResult(name string) bool {
	window := r.messagesSinceLastUser()
	ids := collectToolUseIDs(window, name)
	for i := range window {
		if anyToolResultIn(&window[i], ids) {
			return true
		}
	}
	return false
}

func collectToolUseIDs(window []Msg, name string) map[string]bool {
	out := map[string]bool{}
	for i := range window {
		if window[i].Role != "assistant" {
			continue
		}
		for j := range window[i].Content {
			b := &window[i].Content[j]
			if b.Type == "tool_use" && b.Name == name && b.ID != "" {
				out[b.ID] = true
			}
		}
	}
	return out
}

func anyToolResultIn(m *Msg, ids map[string]bool) bool {
	if m.Role != "user" {
		return false
	}
	for i := range m.Content {
		b := &m.Content[i]
		if b.Type == "tool_result" && ids[b.ToolUseID] {
			return true
		}
	}
	return false
}

// unwrapToolResultContent —— tool_result.content has two wire shapes in Anthropic
// /v1/messages:
//
//  1. JSON-encoded string: `"content": "{\"ok\":true,...}"`
//  2. content-block array: `"content": [{"type":"text","text":"{\"ok\":true,...}"}]`
//
// anthropic-sdk-go's NewToolResultBlock(toolUseID, content string) uses (2); the eino
// claude adapter goes this route. We parse both, and return the innermost JSON bytes
// (with no outer quotes or block wrapper).
func unwrapToolResultContent(raw json.RawMessage) []byte {
	body := []byte(raw)
	if len(body) == 0 {
		return body
	}
	// (2) array of content blocks
	if body[0] == '[' {
		var blocks []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal(body, &blocks); err == nil {
			for i := range blocks {
				if blocks[i].Type == "text" {
					return []byte(blocks[i].Text)
				}
			}
		}
		return body
	}
	// (1) JSON-encoded string
	var asStr string
	if err := json.Unmarshal(body, &asStr); err == nil {
		return []byte(asStr)
	}
	return body
}
