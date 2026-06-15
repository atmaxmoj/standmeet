package inference

import (
	"encoding/json"
	"testing"

	"github.com/cloudwego/eino/schema"
)

const testToolCallID = "call_1"

// system prompt + the 4 valid history messages in validHistoryFixture.
const wantValidMsgCount = 5

// toEinoMessages must never forward an assistant message that has neither
// content nor tool_calls — DeepSeek / any OpenAI-compatible provider rejects it
// with 400 "Invalid assistant message: content or tool_calls must be set".
//
// This is the general guard for summarize / ReturnDirectly and any other "bad
// reply": a turn that produced no text (e.g. summarize_conversation ends the
// loop on a tool artifact) leaves an empty assistant message in history.
// Whether history comes from the live frontend or a DB restore, that message
// must not be able to poison the next turn of the conversation.
func TestToEinoMessagesDropsEmptyAssistant(t *testing.T) {
	t.Parallel()
	in := []ChatRequestMsg{
		{Role: "user", Content: "first question"},
		{Role: "assistant", Content: ""}, // the poison: no content, no tool_calls
		{Role: "user", Content: "second question"},
	}
	got, err := toEinoMessages("", in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	assertNoEmptyAssistant(t, got)
	assertContents(t, got, []string{"first question", "second question"})
}

// Valid messages must survive untouched: assistant-with-content, assistant that
// only carries tool_calls (empty content is legal there), the tool result, and
// the system prompt.
func TestToEinoMessagesKeepsValidMessages(t *testing.T) {
	t.Parallel()
	got, err := toEinoMessages("sys", validHistoryFixture())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != wantValidMsgCount {
		t.Fatalf("expected %d messages (system + 4), got %d: %+v",
			wantValidMsgCount, len(got), got)
	}
	assertRole(t, got[0], schema.System)
	assertToolCallSurvives(t, got[3])
	assertToolResultSurvives(t, got[4], testToolCallID)
}

func validHistoryFixture() []ChatRequestMsg {
	return []ChatRequestMsg{
		{Role: "user", Content: "walk me through the incident"},
		{Role: "assistant", Content: "Here is what happened."},
		{
			Role:    "assistant",
			Content: "", // legal: assistant turn that only calls a tool
			ToolCalls: []ChatToolCallRef{{
				ID: testToolCallID, Name: "summarize_conversation", Args: json.RawMessage(`{}`),
			}},
		},
		{Role: "tool", Content: `{"ok":true}`, ToolCallID: testToolCallID},
	}
}

func assertNoEmptyAssistant(t *testing.T, got []*schema.Message) {
	t.Helper()
	for i := range got {
		if leakedEmptyAssistant(got[i]) {
			t.Fatalf("empty assistant message leaked through at %d: %+v", i, got[i])
		}
	}
}

func leakedEmptyAssistant(m *schema.Message) bool {
	return m.Role == schema.Assistant && m.Content == "" && len(m.ToolCalls) == 0
}

func assertContents(t *testing.T, got []*schema.Message, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("expected %d messages, got %d: %+v", len(want), len(got), got)
	}
	for i := range want {
		if got[i].Content != want[i] {
			t.Fatalf("message %d: want %q, got %q", i, want[i], got[i].Content)
		}
	}
}

func assertRole(t *testing.T, m *schema.Message, want schema.RoleType) {
	t.Helper()
	if m.Role != want {
		t.Fatalf("want role %q, got %q", want, m.Role)
	}
}

func assertToolCallSurvives(t *testing.T, m *schema.Message) {
	t.Helper()
	if m.Role != schema.Assistant || len(m.ToolCalls) != 1 {
		t.Fatalf("tool-call assistant message must survive: %+v", m)
	}
}

func assertToolResultSurvives(t *testing.T, m *schema.Message, wantID string) {
	t.Helper()
	if m.Role != schema.Tool || m.ToolCallID != wantID {
		t.Fatalf("tool result must survive with its id: %+v", m)
	}
}
