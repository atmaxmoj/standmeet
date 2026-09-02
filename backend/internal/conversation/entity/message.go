// message.go —— Message: one row of the messages table. One Dialog writes
// 2 rows (visitor + assistant).
//
// Message is a persistence-layer detail, but it can't be fully sealed into
// the postgres package: the admin transcript API still exposes it
// externally as a "messages array" (the old frontend shape + backward
// compat with the old SSE). So it lives in the domain but stays an
// internal row type — Dialog is preferred as the domain's first-class
// citizen.

package entity

import "time"

// Message —— one message row within a conversation. ToolCalls is the set
// of tool calls the assistant message ran this turn (opaque jsonb, stored
// and read back verbatim by the frontend as [{name,ok,result}]); it's part
// of this dialog — both the owner reviewing later and the visitor
// continuing the chat need to see what the AI searched and which article
// it read.
type Message struct {
	CreatedAt            time.Time
	ID                   string
	ConversationID       string
	Role                 string // 'visitor' | 'assistant'
	Body                 string
	CitedWikiIDs         []string
	CitedWritingIDs      []string
	CitedOutputIDs       []string
	CitedSubjectivityIDs []string
	// GroundedSubjectivityIDs —— subjectivity notes that shaped this turn
	// but weren't opted in (F-A-27). Goes only into the owner's transcript,
	// never read on the visitor side.
	GroundedSubjectivityIDs []string
	ToolCalls               []byte
}
