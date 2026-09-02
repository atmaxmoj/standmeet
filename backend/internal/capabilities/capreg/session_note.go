// session_note.go —— how a fact that only becomes true **after a session
// starts** reaches the model.
//
// A visitor session's system prompt is **fixed when the session is opened,
// assembled by the browser and sent back** (`/sessions` hands down part ids +
// persona; `AgentTurnRequest.System` is composed client-side). Which means: any
// fact that only becomes true partway through the session — quota ran out, a
// connector dropped, a grant got narrowed — **has no path into that prompt**.
//
// That's how F-B-14 happened: when quota ran out the host hid the booking
// capability, the agent had no tool by the third turn, yet the prompt still said
// "you can book meetings" — and **nothing said what had happened**; it ended up
// telling the visitor, to their face, that two real meetings had never been
// booked. The earlier fix for F-B-10 worked around this by pushing the fact into
// the **tool result** (`can_book`), since a tool result is computed fresh on
// every call.
//
// This file provides the missing channel itself: a capability can say one thing
// for **this session**, and the host splices it into the instruction every turn.
// The capability decides what to say (the host doesn't know about booking), and
// decides when to say it too (only the capability knows its own gate).

package capreg

import "context"

// SessionNoter —— optional interface: does this capability have something it
// must say for **this specific session**.
//
// Empty = nothing to say. What sets it apart from SystemPromptFragment is
// timing: a fragment is the static manual fixed at session start, a note is
// asked fresh every turn — a fact that belongs to this session, right now.
type SessionNoter interface {
	SessionNote(ctx context.Context, in *AssembleInput) string
}

// SessionNotes —— what each capability wants to say in this session, in
// registration order. Empty is an empty slice (not nil).
func (r *Registry) SessionNotes(ctx context.Context, in *AssembleInput) []string {
	out := make([]string, 0, 1)
	for _, c := range r.enabledCaps(ctx, in) {
		noter, ok := c.(SessionNoter)
		if !ok {
			continue
		}
		if note := noter.SessionNote(ctx, in); note != "" {
			out = append(out, note)
		}
	}
	return out
}
