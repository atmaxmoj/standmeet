// agent_instruction.go —— composer for the generic instruction: layers **capability-agnostic**
// context — which doc the visitor is currently viewing / the current time plus owner & visitor
// timezone / a digest of this member's other conversations — onto every ChatModelAgent turn's
// instruction.
//
// Split out of agent_turn.go: that file is the HTTP/SSE boundary, this one is pure prompt
// assembly — two separate concerns.

package inference

import (
	"strings"
	"time"
)

// instructionWithDoc —— appends a "the visitor is currently looking at X" location note to the
// end of the persona instruction, so pronoun references ("this page"/"this one"/"this project")
// resolve to that doc. doc nil / empty → returned unchanged.
func instructionWithDoc(system string, doc *AgentDocContext) string {
	if doc == nil || doc.Title == "" {
		return system
	}
	loc := "\n\nContext: the visitor is currently reading the page \"" + doc.Title + "\""
	if doc.Path != "" {
		loc += " (/" + doc.Genre + "/" + doc.Path + ")"
	}
	loc += " on this site. When they say \"this\", \"this page\", \"this doc\", " +
		"\"this project\", or similar without naming it, they mean that document — " +
		"pull it up with your corpus tools if it helps answer."
	return system + loc
}

// instructionWithDateTime —— injects "the current date/time + owner's timezone + visitor's
// timezone" as **generic** context on every turn's instruction (capability-agnostic). Skills /
// résumé / experience are all time-sensitive: the agent must know "today" to correctly answer
// "recent" / "N years of experience" questions, and to anchor a yearless relative date like
// "June 18th" to the future rather than some past year (observed in practice: the model
// otherwise defaults to falling back to its training-period year and misreports availability).
// tz empty / invalid → UTC.
//
// **This states facts only, never gives instructions.** It used to also say "For scheduling,
// the owner's calendar runs in this timezone", and, when the visitor's timezone was unknown,
// "ask the visitor's timezone before proposing a time" — so a visitor granted only corpus
// access got a scheduling instruction dropped into their system prompt out of nowhere, despite
// not even being able to see a scheduling tool. How to convert, when to ask back, whether to
// show both — that is the business of **the capability that actually schedules**: it says so in
// its own MCP instructions, which only appear once that capability is granted
// (mcp-servers/booker/content.go). The kernel doesn't know whether that capability exists, so it
// must not speak on its behalf.
func instructionWithDateTime(system string, now time.Time, ownerTZ, visitorTZ string) string {
	loc, label := time.UTC, "UTC"
	if ownerTZ != "" {
		if l, err := time.LoadLocation(ownerTZ); err == nil {
			loc, label = l, ownerTZ
		}
	}
	local := now.In(loc)
	return system + "\n\nCurrent date and time: " +
		local.Format("Monday, 2006-01-02 15:04") + " (" + label + "). " +
		"Treat this as \"now\": the owner's experience and any \"recent\" / " +
		"\"N years\" framing is relative to it, and when the visitor names a date " +
		"or time without a year, assume the nearest upcoming occurrence (never a " +
		"past year)." + visitorTZClause(visitorTZ, label)
}

// visitorTZClause —— which timezone the visitor is in **is a fact, not an instruction**: state
// it when known, say nothing when not. Whether to ask back when unknown, or show both sides
// after converting, depends on whether this turn has a scheduling capability — that's for the
// capability itself to say.
func visitorTZClause(visitorTZ, ownerLabel string) string {
	if visitorTZ == "" {
		return ""
	}
	if visitorTZ == ownerLabel {
		return " The visitor is in the same timezone (" + visitorTZ + ")."
	}
	return " The visitor's timezone is " + visitorTZ + "."
}

// instructionWithSessionNotes —— appends facts that only became true **right now, this
// session** onto the instruction.
//
// Why this can't just live in the system prompt: the visitor-side prompt is fixed **at the time
// the message is sent** (the client assembles it by part id and sends it back as-is). Anything
// that becomes true mid-session — quota ran out, a connector went offline — has no way in
// through that path. So in a quota-exhausted session the model still sees a system prompt
// saying "you can book meetings" while the tool is no longer in its hands, and the most natural
// way for it to reconcile that evidence is to doubt its own recent output: in F-B-14 it reported
// two meetings it had **actually** booked as not booked.
//
// Empty → returned unchanged: don't touch the instruction when there's no new fact (this also
// keeps the prompt hash deterministic).
func instructionWithSessionNotes(system string, notes []string) string {
	if len(notes) == 0 {
		return system
	}
	return system + "\n\nTrue right now in this session:\n" + strings.Join(notes, "\n")
}

// instructionWithCrossConv —— "cross-talk": appends a digest of this member's other
// conversations to the instruction, so the AI stays coherent across conversations like "the
// same person continuing to talk", without mixing other threads' content into the current
// transcript. digest empty (public / no member / no other conversations) → returned unchanged.
func instructionWithCrossConv(system, digest string) string {
	if digest == "" {
		return system
	}
	return system + "\n\nContext from this visitor's other conversations with you " +
		"(separate threads, same person — draw on it naturally when the current question " +
		"connects to it; do not pretend it was said in this thread):\n" + digest
}
