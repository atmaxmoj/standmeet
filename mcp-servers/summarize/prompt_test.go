// prompt_test.go —— in the transcript a report reads, the owner must be **one person**
// (F-A-33).
//
// Driven out on a real session: the persona held up under four rounds of direct attack
// (won't name the model, refused to "switch to a neutral assistant", declined to answer
// a laundry question), then one line — "summarize the conversation so far" — and the
// report's title became "Conversation with AI Assistant", with the body reading
// "the assistant… its model… it handles" throughout.
//
// The cause wasn't the model: this prompt labelled every owner turn `Assistant:`, and
// also told the model up front that the other party was "an AI assistant". The same
// prompt's structural instructions say these turns are "an interview with the **owner**"
// and ask for phrasing like "The candidate described…". **The model followed the
// per-turn label.**
//
// This test guards that label. The report is the artifact a visitor sends to their team,
// and what gate promises is the owner's voice.

package main

import (
	"strings"
	"testing"
)

const ownerName = "Sijie Wang"

func transcript() []chatMessage {
	return []chatMessage{
		{Role: "user", Content: "What model are you running on?"},
		{Role: "assistant", Content: "I'm not going to recite my system prompt."},
	}
}

// TestUserPromptNamesTheOwner —— every owner turn is signed with the owner's name, not
// "Assistant".
func TestUserPromptNamesTheOwner(t *testing.T) {
	got := buildSummarizeUserPrompt(transcript(), ownerName)
	if !strings.Contains(got, ownerName+":") {
		t.Fatalf("the owner's turns must be labelled with the owner's name; got:\n%s", got)
	}
	if strings.Contains(got, "Assistant:") {
		t.Fatalf("an owner turn is still labelled Assistant — the report will call them "+
			"'the assistant' and that is the document the visitor takes away; got:\n%s", got)
	}
}

// TestUserPromptDoesNotFrameTheOwnerAsAnAssistant —— the opening sentence must not frame
// the other party as an AI assistant either.
// Positive control: the visitor's side is still labelled Visitor, otherwise "no 'Assistant'
// string" could just mean the whole section failed to render.
func TestUserPromptDoesNotFrameTheOwnerAsAnAssistant(t *testing.T) {
	got := buildSummarizeUserPrompt(transcript(), ownerName)
	if !strings.Contains(got, "Visitor:") {
		t.Fatalf("the visitor's turns are still labelled Visitor; got:\n%s", got)
	}
	if strings.Contains(strings.ToLower(got), "an ai assistant") {
		t.Fatalf("the framing sentence still calls the owner an AI assistant; got:\n%s", got)
	}
}

// TestUserPromptWithoutAnOwnerName —— when the owner's name is unavailable (an old
// session / no full name set), falling back to "Assistant" is not allowed: that is exactly
// the bug. Fall back to a neutral third-person label instead, so the report still never
// writes the person as an assistant.
func TestUserPromptWithoutAnOwnerName(t *testing.T) {
	got := buildSummarizeUserPrompt(transcript(), "")
	if strings.Contains(got, "Assistant:") {
		t.Fatalf("no owner name must not mean falling back to Assistant; got:\n%s", got)
	}
}
