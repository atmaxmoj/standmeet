// conversation_view.go —— view types for the conversation aggregate read model (split
// out of visitor_history.go to stay under max-public-structs). Three conceptual
// layers: code → session → conversation.

package usecase

import "time"

// Conversation —— the conversation aggregate itself. count = len(Dialogs) (no used
// field); only contains fully-answered turns. A conversation never closes (generating a
// summary doesn't seal it); summary is a separate chat_reports artifact, not attached here.
type Conversation struct {
	StartedAt time.Time
	Dialogs   []ConvDialog
	// Events —— things that **happened** in this conversation (the visitor cancelled a
	// meeting on a card, sent a confirmation email), not something someone said (F-B-9).
	// Kept in its own field, separate from Dialogs: a dialog is "one question, one
	// answer" and an event doesn't have that shape — forcing it in would break
	// pairDialogs' pairing.
	//
	// After a frontend refresh these need to be folded back into **the message list the
	// model sees** —— otherwise a meeting cancelled on a card is forgotten by the agent
	// again once the page is reopened.
	Events []ConvEvent
}

// ConvEvent —— a record of one card action. Text is the exact sentence written at the
// time (`[card action] …`).
type ConvEvent struct {
	CreatedAt time.Time
	Text      string
}

// ConvCode —— the quota view of the code this conversation's session belongs to
// (conceptually belongs to the code, not to the conversation). MemberCount = how many
// sessions have been opened under this code.
type ConvCode struct {
	MaxTurnsPerSession int32
	MaxMembers         int32
	MemberCount        int
}

// ConvSession —— the session view found by token: identity + owning code + this
// member's total used turns. UsedTurns is **member-level** (summed across this
// person's entire conversation history); the frontend strip shows used based on this ——
// under the multi-conversation model the frontend can no longer count from a single
// surface's local dialogs, that would undercount.
type ConvSession struct {
	VisitorName string
	Code        ConvCode
	UsedTurns   int32
}

// VisitorView —— what the endpoint returns as a whole: session (the entry point to find
// the conversation) + its conversation. Two concepts, each in its own block, not mixed.
type VisitorView struct {
	Conversation Conversation
	Session      ConvSession
}
