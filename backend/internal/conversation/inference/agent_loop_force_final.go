// agent_loop_force_final.go —— the boundary's one rescue call. When the loop ends with no answer
// (agent_loop_budget.go decides when), forceFinalAnswer makes ONE tool-less call that synthesizes
// from the evidence the turn already gathered. Its own budget, its own nudge.

package inference

import (
	"context"
	"os"
	"strconv"
	"time"
)

// forceFinalTimeout —— the boundary synthesis's own budget. Must survive the turn's expired
// deadline (the time wall is exactly when it's needed), so it runs on a detached, bounded
// context — never unbounded, never the dead parent.
//
// Can run out itself (measured in prod: 24 evidence items, a reasoning model, 60s not enough).
// What the product says on that path is wrapped up by handleTerminalError — see StopDeadline.
const defaultForceFinalTimeout = 60 * time.Second

// FORCE_FINAL_TIMEOUT (seconds) overrides the default — like AGENT_TURN_TIMEOUT, exists for
// e2e to **force out the path after the boundary too**: both budgets must be short before the
// "rescue attempt also failed" cell is even reachable.
func forceFinalTimeout() time.Duration {
	if s := os.Getenv("FORCE_FINAL_TIMEOUT"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return defaultForceFinalTimeout
}

// forceFinalAnswer —— a single tool-less wrap-up call: the turn's contract is ONE grounded
// answer, so when the loop ends without one (budget exhausted / bad tool name / mid-stream
// blip) we make one tool-less call that must produce it.
//
// Answers FROM the material this turn already gathered (evidenceDigest). A broad question over
// a big linked vault can burn the whole budget crawling; throwing those findings away would
// make the fallback say "I have no specifics" right after reading 26 notes — the worst possible
// boundary behaviour. The grounding rule stays in the system prompt, so with no evidence it
// still honestly gives up rather than fabricating. Returns empty on failure; caller wraps up.
func forceFinalAnswer(ctx context.Context, em *loopEmit, state *turnState) string {
	if em.in == nil || em.in.Req == nil {
		return ""
	}
	// Detach from the (possibly expired) turn ctx: the forced synthesis is the boundary's last
	// act, own short budget. Without this a turn-timeout kills the rescue call itself (observed
	// live: 26 retrievals → "That took too long", everything discarded).
	fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), forceFinalTimeout())
	defer cancel()
	ctx = fctx
	msgs := make([]ChatRequestMsg, 0, len(em.in.Req.History)+2)
	msgs = append(msgs, em.in.Req.History...)
	msgs = append(msgs, ChatRequestMsg{Role: "user", Content: em.in.Req.UserMessage})
	if len(state.evidence) > 0 {
		msgs = append(msgs, ChatRequestMsg{
			Role: "user", Content: evidenceDigest(state.evidence, state.evidenceTotal),
		})
	}
	sys := em.in.Req.System + forceFinalNudge(len(state.evidence))
	// Own output budget (BoundaryMaxTokens): default 4096 gets eaten entirely by reasoning
	// tokens on a reasoning model — measured in prod, boundary fired, 40s later an empty string
	// with no error. Rescue step must not share its budget with the step it rescues (F-A-40 #5).
	out, err := Generate(ctx, em.in.Cred, &ChatRequest{
		System: sys, Messages: msgs, MaxTokens: BoundaryMaxTokens,
	})
	if err != nil {
		em.log.Warn("agent turn force-final generate", logErrKey, err)
		return ""
	}
	return out
}

// forceFinalNudge —— the instruction turning an exhausted crawl into an answer. Must forbid the
// two failure modes observed (F-A-4): narrating the process ("Let me survey…"), and promising
// to look further. With evidence it demands synthesis + honest incompleteness, not a blanket
// "I don't know".
func forceFinalNudge(evidenceItems int) string {
	if evidenceItems == 0 {
		return "\n\n(You've used your search budget for this turn. Answer now from what you " +
			"already know, without searching further. If you don't have a specific example, " +
			"say so briefly in your own voice and move on.)"
	}
	return "\n\n(You've used your search budget for this turn — you cannot search again. " +
		"Answer the visitor NOW, in your own voice, synthesising the material you already " +
		"retrieved (included below). Do not narrate your process, do not say you will look " +
		"further, and do not open with \"Let me\". If the material doesn't cover part of the " +
		"question, say briefly what you didn't get to, then answer what you can.)"
}
