// agent_turn_wire.go —— the **on-wire shape** of `/agent/turn`: the body the browser sends.
//
// Kept separate from AgentTurnInput (what this turn needs to run, filled in by the route
// handler): one is what comes from outside, the other is what's needed inside. Mixed together
// in one file, a reader can no longer tell which fields the **caller gets to decide** — and that
// boundary is exactly where a security judgment starts (that system is assembled by the client
// and sent back as-is is half of F-B-14).

package inference

// AgentTurnRequest —— the browser's POST body.
//
// system + user_message are used directly, assembled as the ChatModelAgent's instruction + user
// input; history is the conversation record from before the current turn (may contain assistant
// tool_calls / tool results, in the pi unified shape), passed to ADK as context.
//
// Warning: System is **assembled by the client**: `/sessions` hands down a part id + persona,
// the browser fetches the text and assembles it before sending it back. Which means it reflects
// the world **as of the moment the session was sent**. Facts that only became true mid-session
// (quota ran out, a connector went offline) can't get into this field — those go through
// `AgentTurnInput.SessionNotes` instead (F-B-14).
//
// ConversationID —— the persisted chat ID (returned by issueSession); used by backend-internal
// tools (calendar_book / dialog persist) to associate this turn's output with the correct
// conversation row. The old /sessions/{convID}/tools/{name} wire passed it via the URL path; the
// new /agent/turn passes it through the body.
type AgentTurnRequest struct {
	DocContext      *AgentDocContext `json:"doc_context,omitempty"`
	System          string           `json:"system"`
	UserMessage     string           `json:"user_message"`
	ConversationID  string           `json:"conversation_id"`
	Model           string           `json:"model,omitempty"`
	VisitorTimezone string           `json:"visitor_timezone,omitempty"`
	History         []ChatRequestMsg `json:"history,omitempty"`
}

// AgentDocContext —— the minimal identity of the document the visitor is currently on
// (used for pronoun reference resolution).
type AgentDocContext struct {
	Title string `json:"title"`
	Path  string `json:"path"`
	Genre string `json:"genre"` // wiki | output | writing
}
