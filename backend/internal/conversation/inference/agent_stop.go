// agent_stop.go —— **how this turn ends, and which word gets told to the visitor**.
//
// Split out of agent_loop_budget.go (that file hit the max-lines gate, and the gate wants
// splitting, not an exemption): that file covers "how the budget ran out", this one covers
// "what this turn gets called once it has" — two different readers, one is ops reading logs,
// the other is the visitor looking at the screen.
//
// Every new stop reason added here also needs `proxy_wire.go`'s `productStops` to recognize
// it, otherwise mapFinishReason's default will silently rewrite it into "finished normally"
// (that's exactly how F-A-35 leaked through). That list has exactly one place it lives.

package inference

// StopNoAnswer —— stop reason: this turn **produced not one word of an answer**, and it
// couldn't be rescued (F-A-35).
//
// Why it must be its own kind rather than reusing max_tokens / tool_use: those two describe
// **how it stopped**, while what the visitor needs to know is **what the outcome was**. "said
// half of it" and "said nothing at all" mean different next steps for them — the former can ask
// "what about the rest", the latter can only ask a narrower question again. The product used to
// say the same "ask for the rest" for both, promising a rest that didn't exist.
const StopNoAnswer = "no_answer"

// StopDeadline —— stop reason: **time ran out**, and even the boundary's rescue attempt
// didn't finish in time (F-A-44).
//
// Kept separate from StopNoAnswer because the visitor's next action differs: this one calls
// for a narrower question, not "try again". What prod's incident looked like: 64 notes read,
// the boundary fired, the rescue attempt's 60 seconds also ran out, and the visitor then read
// "The connection dropped before a reply came back. Please try asking again." — the connection
// was fine the whole time, and "try again" would hit the same wall.
const StopDeadline = "deadline"

// doneStop —— the closing word handed to the visitor's side.
//
// Four branches, each matching a **different thing** the visitor is left holding:
//   - claimed an action was completed with no receipt for it → `claim_unbacked` (overrides
//     everything else, F-A-37)
//   - time ran out, and even the rescue attempt didn't finish → `deadline` (F-A-44)
//   - rescued → a complete answer exists → `end_turn` (must not say max_tokens: there's no
//     rest left to ask for)
//   - not rescued, body is empty → **there's genuinely nothing in hand** → `no_answer`
//   - everything else → passed through unchanged (there's a body, it just didn't finish)
//
// The criterion is `product == ""`, not any specific stop reason: any outcome of "ended
// normally but produced nothing" is the same situation, and shouldn't need patching again the
// next time a new finish_reason shows up ([[lesson-not-swept-to-neighbours]]; same root cause
// as the condition in ensureProduct).
//
// The logs still record the real stop + recovered as they are — the two readers want different
// things.
func doneStop(state *turnState) string {
	if state.stop == StopClaimUnbacked || state.stop == StopDeadline {
		return state.stop
	}
	if state.recovered {
		return "end_turn"
	}
	if state.product == "" {
		return StopNoAnswer
	}
	return state.stop
}
