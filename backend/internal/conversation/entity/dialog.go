// dialog.go -- Dialog: the domain concept for one round of Q&A.
// A Dialog = visitor question + AI answer + which corpus items the AI cited.
// The persistence layer stores it as two messages rows (role=visitor +
// role=assistant) -- that's the mapper's concern; at the domain layer,
// Dialog is first-class.
//
// The frontend's `Turn` is an old name for the same concept (coined at the
// D-5 pi-pivot, from the agent loop iteration's point of view). Unify on
// Dialog.

package entity

import "time"

// Dialog -- one round: visitor question + AI answer + cited.
//
// The ID field temporarily borrows the assistant message's id as the
// dialog identifier (there's no separate dialog table in the DB yet).
// Callers use this when they need to reference a single round.
type Dialog struct {
	CreatedAt time.Time
	ID        string
	ChatID    string
	Question  string
	Answer    string
	Citations []Citation
	// GroundedSubjectivityIDs -- subjectivity note ids read this round but not opted in. They
	// shaped the voice but don't reach the visitor footer; they land in the owner-only column
	// (F-A-27). Kept separate from Citations: the visitor path only ever sees Citations.
	GroundedSubjectivityIDs []string
	ToolCalls               []byte
}

// DialogInit -- constructor args for NewDialog (bundled to dodge the argument-limit lint).
type DialogInit struct {
	CreatedAt time.Time
	ChatID    string
	Question  string
	Answer    string
	Citations []Citation
	// GroundedSubjectivityIDs -- subjectivity note ids read this round but not opted in. They
	// shaped the voice but don't reach the visitor footer; they land in the owner-only column
	// (F-A-27). Kept separate from Citations: the visitor path only ever sees Citations.
	GroundedSubjectivityIDs []string
	ToolCalls               []byte
}

// NewDialog -- constructs a dialog (createdAt uses the caller-supplied time, to ease
// testing and persistence-layer replay). ToolCalls is the assistant's tool calls for
// this round (opaque jsonb).
func NewDialog(in *DialogInit) Dialog {
	return Dialog{
		ChatID: in.ChatID, Question: in.Question, Answer: in.Answer,
		Citations:               in.Citations,
		GroundedSubjectivityIDs: in.GroundedSubjectivityIDs,
		ToolCalls:               in.ToolCalls, CreatedAt: in.CreatedAt,
	}
}
