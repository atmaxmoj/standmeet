// agent_claim_gate.go — F-A-37: when a turn's answer claims it completed some action, that
// turn must carry a success receipt from that tool, or the host rules the turn invalid.
//
// Why this needs a mechanism, not a prompt line: in the real environment, after booking four
// meetings, the fifth reply was *"Booked. ✅ Monday, August 31 · 13:00–13:30 UTC … Invite went
// to …"* — that turn called **zero tools**, and the real calendar stayed empty all day. The
// browser only replays history as `{role, content}` — the model reads back its own four earlier
// "Booked" messages and sees no trace of any tool call, so it completes the pattern with **that
// sentence**. Adding "don't make things up" to the prompt only nudges the probability down a
// little; a capability's job is the "did it happen / not" action, and the judging criterion has
// to be the receipt.
//
// The kernel side only recognizes two things: which tools got a **successful** result this turn,
// and the "completion" phrasings a capability declares. It doesn't know what booking is (gates
// are declared by capabilities in their manifest, brought in at assembly time).

package inference

import (
	"log/slog"
	"strings"
)

// StopClaimUnbacked — stop reason: this turn claims it did something, with no receipt for it.
//
// It sits on the same channel as end_turn / max_tokens (the `done` frame's stop), because the
// client **already** decides how to present a turn based on stop (F-A-34's truncation notice
// uses this same path). What the visitor renders is the product's own wording, not the model's —
// the "Booked" that already streamed out can't be pulled back, but whether the turn counts is
// the product's call.
const StopClaimUnbacked = "claim_unbacked"

// ClaimGate — a necessary condition brought into this turn. A successful receipt from Tool
// means this kind of claim is backed.
type ClaimGate struct {
	Tool    string
	Phrases []string
}

// claims — whether this answer asserts the action is already complete (lowercase substring).
func (g *ClaimGate) claims(answer string) bool {
	low := strings.ToLower(answer)
	for _, p := range g.Phrases {
		if p != "" && strings.Contains(low, strings.ToLower(p)) {
			return true
		}
	}
	return false
}

// applyClaimGate — one judgment at wrap-up: an unbacked claim → the product rewrites how this
// turn ends, and logs one line saying which tool's receipt was missing (skip that and ops only
// ever sees a normally-ended turn).
func applyClaimGate(log *slog.Logger, state *turnState, gates []ClaimGate) {
	g := unbackedClaim(state, gates)
	if g == nil {
		return
	}
	log.Warn("agent turn claimed an action it did not perform",
		"tool", g.Tool, "answer_chars", len(state.product),
		"note", "the answer asserts a completed action with no ok result from that tool this turn")
	state.stop = StopClaimUnbacked
}

// unbackedClaim — the gate this turn violated (nil if none).
//
// The criterion is a **necessary condition**, not "was the model right": the answer contains a
// completion phrase, and this turn's tool has no successful receipt → the turn doesn't count.
// The converse isn't gated: calling the tool without saying so, or merely proposing/asking, is
// not a claim.
func unbackedClaim(state *turnState, gates []ClaimGate) *ClaimGate {
	answer := strings.TrimSpace(state.product)
	if answer == "" {
		return nil
	}
	for i := range gates {
		if violates(&gates[i], answer, state.okTools) {
			return &gates[i]
		}
	}
	return nil
}

// violates — did this turn violate this gate. An incompletely declared gate is never judged
// (when it can't be judged, "don't gate" beats "gate blindly").
func violates(g *ClaimGate, answer string, okTools map[string]bool) bool {
	if g.Tool == "" || len(g.Phrases) == 0 {
		return false
	}
	return g.claims(answer) && !okTools[g.Tool]
}

// markToolOK — record "this tool returned successfully once this turn." A failed receipt
// doesn't count as a receipt: the capability error convention is `{"ok":false,...}`, and that
// kind of receipt can't back "already completed."
//
// Recorded separately rather than reusing evidence: evidence is **capped** (on a long crawl it
// keeps head and tail, drops the middle), and using it as the receipt would let the gate pass
// vacuously in a turn with many tool calls.
func markToolOK(state *turnState, tool, result string) {
	if tool == "" || toolResultFailed(result) {
		return
	}
	if state.okTools == nil {
		state.okTools = map[string]bool{}
	}
	state.okTools[tool] = true
}

// toolResultFailed — does the receipt claim it failed. The uniform error convention across
// capabilities is a top-level `"ok": false`.
func toolResultFailed(result string) bool {
	compact := strings.ReplaceAll(result, " ", "")
	return strings.Contains(compact, `"ok":false`)
}
