// agent_loop_budget.go —— the turn's ITERATION BUDGET, and what happens when it runs out.
//
// The turn's contract with the visitor is ONE grounded, synthesized answer; planning/tool
// chatter is process, not product. A real vault is a linked graph, so a broad question
// legitimately crawls deep, and ANY budget can be exhausted by a long enough chain — so the
// budget is only half the design. The boundary is the other half, and it lives here:
//
//   - maxAgentIterations —— sized for real linkage chains, not a toy.
//   - recordEvidence     —— every tool result is kept (bounded), so a crawl's findings survive.
//   - handleTerminalError/forceFinalAnswer —— when the loop ends with no answer, force ONE
//     tool-less call that synthesizes FROM the gathered evidence. Never raw planning narration
//     (F-A-4), never an empty frame, never "I have no specifics" after reading 26 notes.

package inference

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/cloudwego/eino/adk"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

// maxAgentIterations —— tool-calling rounds allowed per turn.
//
// The owner's vault is a linked GRAPH: a broad question legitimately crawls deep
// (search → read → follow [[links]] → read again), so this is sized for real linkage chains,
// not a toy. But it's a BUDGET, not a guarantee — ANY budget can be exhausted by a long enough
// chain. Raising it is necessary, never sufficient: what actually keeps the turn's contract
// with the visitor (one grounded, synthesized answer) is the exhaustion path below
// (handleTerminalError → forceFinalAnswer), which synthesizes from whatever WAS gathered.
const maxAgentIterations = 24

// Evidence budget for the exhaustion synthesis. The fallback is ONE model call, so the material
// carried into it must be bounded. WHICH results we keep is a real design choice: pure
// recent-bias is wrong. The chain-exhaustion eval caught it — a 33-hop crawl pushed the chain's
// HEAD out of the window, and the model told the visitor "I don't have a photosynthesis note"
// about a note that plainly exists. So keep BOTH ends, sacrifice the middle: the head is where
// the crawl started (what the visitor asked about), the tail is where it got deepest.
const (
	evidenceHeadCap = 8                                 // earliest results kept
	evidenceTailCap = 16                                // most recent results kept
	evidenceCap     = evidenceHeadCap + evidenceTailCap // total carried into the fallback
	evidenceItemCap = 2000                              // bytes kept per result
)

// gatheredEvidence —— one tool result collected this turn; on exhaustion the forced synthesis
// answers FROM these, so a long crawl is never thrown away.
type gatheredEvidence struct {
	tool   string
	result string
}

// recordEvidence —— record a tool result (truncated on a rune boundary), keeping the crawl's
// head and its most recent tail; the middle is sacrificed when the cap is hit. evidenceTotal
// keeps counting, so the digest can flag the record PARTIAL instead of implying absence.
func recordEvidence(state *turnState, tool, result string) {
	state.evidenceTotal++
	state.evidence = append(state.evidence, gatheredEvidence{
		tool: tool, result: textcut.BytesMark(result, evidenceItemCap),
	})
	if len(state.evidence) <= evidenceCap {
		return
	}
	kept := make([]gatheredEvidence, 0, evidenceCap)
	kept = append(kept, state.evidence[:evidenceHeadCap]...)
	kept = append(kept, state.evidence[len(state.evidence)-evidenceTailCap:]...)
	state.evidence = kept
}

// evidenceDigest —— the gathered material, framed for the exhaustion synthesis. When the record
// is partial it MUST say so: otherwise the model reads the gap as absence and tells the visitor
// a note doesn't exist when it does (exactly what the chain-exhaustion eval caught).
func evidenceDigest(ev []gatheredEvidence, total int) string {
	// strings.Builder's Write* never errors; discarded explicitly (revive unhandled-error).
	var b strings.Builder
	if total > len(ev) {
		_, _ = fmt.Fprintf(&b,
			"Material you retrieved this turn — a PARTIAL record: the first %d and the most "+
				"recent %d of %d results (the middle is omitted for length). Something missing "+
				"from this list does NOT mean it is absent from your corpus — you simply ran "+
				"out of budget before covering it. Answer from what IS here, and say plainly "+
				"which part you didn't get to.\n\n",
			evidenceHeadCap, evidenceTailCap, total)
	} else {
		_, _ = b.WriteString("Material you already retrieved this turn — answer from it:\n\n")
	}
	for i := range ev {
		_, _ = b.WriteString("--- ")
		_, _ = b.WriteString(ev[i].tool)
		_, _ = b.WriteString(" ---\n")
		_, _ = b.WriteString(ev[i].result)
		_, _ = b.WriteString("\n\n")
	}
	return b.String()
}

// logTurnStop —— **why** this turn ended. Belongs in this file, not the driving side: this is
// the fourth way a budget gets exhausted, and this file is the half that says "budget is only
// half the design, the boundary is the other half".
//
// The first three (iteration cap, timeout, terminal error) get wrapped up through
// handleTerminalError / forceFinalAnswer. The fourth — the model's own **output budget**
// running out — isn't an error: the stream closes normally, the body stops mid-sentence, or
// sometimes has nothing at all. In the logs it used to look identical to a normally-finished
// turn (F-A-34). The **closing wrap-up was only added for this turn** (F-A-40, see
// ensureProduct). `recovered` is logged alongside: "the budget ran out" and "the budget ran
// out but we rescued the answer" are two different things.
func logTurnStop(log *slog.Logger, state *turnState) {
	log.Info("agent turn stop",
		"stop", state.stop, "answer_chars", len(state.product), "recovered", state.recovered)
}

// ensureProduct —— **the boundary for the fourth path**: the stream ended normally, and the
// visitor got nothing (F-A-40).
//
// Prod symptom: `SEARCHED 51 · READ 4` → blank body → one line "this answer was cut short —
// ask for the rest", with no rest to ask for. Log read `stop=max_tokens answer_chars=0`: no
// timeout, no iteration cap — the model spent its **entire output budget** on tool calls and
// wrote nothing. Not an error, so it bypassed handleTerminalError and hard-stopped directly.
// The criterion's first line: "**the boundary is engineered; a bigger budget is not a
// boundary**" — this path used to have only the budget. What's added: **the evidence was
// already gathered** (all 51 results sit in `state.evidence`), so it goes through the same
// wrap-up as the other three — a single tool-less synthesis. Condition is `product == ""`, not
// `stop == "max_tokens"`: any "closed normally but produced nothing" outcome should hit this
// one boundary, not get repatched per new finish_reason ([[lesson-not-swept-to-neighbours]]).
func ensureProduct(ctx context.Context, em *loopEmit, state *turnState) {
	if hasProduct(state) || state.forcedFinal {
		return
	}
	// No tool ran even once, no evidence at all: the model **did nothing and closed
	// empty-handed**. Another synthesis attempt would just cost the visitor a round trip —
	// same judgment as "don't drag it out once the provider is hung" in surfaceInsteadOfForce.
	if len(state.evidence) == 0 {
		em.log.Warn("agent turn ended with no answer and no evidence", "stop", state.stop)
		return
	}
	em.log.Warn("agent turn ended with no answer; forcing synthesis from evidence",
		"stop", state.stop, "evidence_items", len(state.evidence))
	recovered := forceFinalAnswer(ctx, em, state)
	if recovered == "" {
		markRescueFailed(ctx, em, state, nil)
		return
	}
	em.sink.Text(recovered)
	state.assistantText += recovered
	state.product += recovered
	state.recovered = true
}

// markRescueFailed —— **the boundary fired, and the rescue attempt still failed** — what this
// turn gets called.
//
// Two doors lead here: `handleTerminalError` (loop ended with an error) and `ensureProduct`
// (loop ended normally, produced nothing). Prod caught the former; e2e reproduced the latter —
// the first fix covered only the former, the test stayed red, and the `forcing final answer`
// log line wasn't there ([[lesson-not-swept-to-neighbours]]). So the verdict is centralized
// here, and both doors go through it.
//
// Running out of time is **a specific kind of ending**, not a fault: the visitor should ask a
// narrower question, not "try again". Everything else (error frame / no_answer) stays as-is.
func markRescueFailed(ctx context.Context, em *loopEmit, state *turnState, err error) {
	if !deadlineWall(ctx, err) {
		return
	}
	em.log.Warn("agent turn: boundary synthesis also ran out of time",
		"evidence_items", len(state.evidence))
	state.stop = StopDeadline
}

// The stop reasons (StopNoAnswer / StopDeadline) and doneStop live in agent_stop.go — that file
// covers "what this turn gets called", this file covers "how the budget ran out".

// recordTurnUsage —— #106: at turn end, hands accumulated tokens to the injected RecordUsage
// (when cred/model exist + usage is non-zero). nil recorder (stateless smoke test) / BYOAI
// (route passes a no-op) / zero usage → not recorded.
func recordTurnUsage(ctx context.Context, in *AgentTurnInput, state *turnState) {
	if in.RecordUsage == nil || in.Cred == nil {
		return
	}
	if state.inTokens == 0 && state.outTokens == 0 {
		return
	}
	in.RecordUsage(ctx, &TurnUsage{
		Model: in.Cred.Model, In: state.inTokens, Out: state.outTokens,
		Cached: state.cachedTokens,
	})
}

// handleTerminalError —— the agent loop ended with an error. Never hand the caller an empty
// answer: when nothing was written (a MaxIterations deadlock, a hallucinated tool name, a
// mid-stream transient blip), force one more **tool-less** model call (forceFinalAnswer) so the
// model finishes its thought with the context it already has — a real in-voice, persona-aware
// answer / an honest give-up, instead of an empty / error frame. A genuine provider failure
// makes Generate fail too → surfaces to sink.Error (real error behavior preserved). When a
// usable answer already streamed: MaxIterations is a clean truncated ending (no error frame);
// other errors still surface. Returns false to stop consumption. stop still defaults to end_turn.
func handleTerminalError(
	ctx context.Context, em *loopEmit, state *turnState, err error,
) bool {
	maxIter := errors.Is(err, adk.ErrExceedMaxIterations)
	if surfaceInsteadOfForce(ctx, state, err) {
		em.sink.Error(err)
		// The error IS this turn's ending: ensureProduct must not force a synthesis after it —
		// another call into the same wall, and text after the error frame.
		state.forcedFinal = true
		return false
	}
	// Otherwise force a no-tool synthesis. On MaxIterations the model may have streamed only
	// planning narration ("Let me survey… Let me dig into…") and never synthesized — that is
	// NOT an answer (F-A-4). Force one so the visitor always gets a real reply; also covers
	// the no-text cases (hallucinated tool name, mid-stream blip).
	em.log.Warn("agent turn forcing final answer", logErrKey, err,
		"evidence_items", len(state.evidence))
	state.forcedFinal = true // ensureProduct won't add a second one (just another round trip)
	if recovered := forceFinalAnswer(ctx, em, state); recovered != "" {
		em.sink.Text(recovered)
		state.assistantText += recovered
		state.product += recovered // the forced synthesis IS the answer
		state.recovered = true
		return false
	}
	if maxIter {
		em.log.Warn("agent turn max iterations; force-final produced nothing")
		return false
	}
	// The rescue attempt failed too. **This is still not "the connection dropped"** (F-A-44):
	// measured once in prod — 64 notes read, the boundary fired, the rescue attempt's 60
	// seconds also ran out, and the visitor read *"The connection dropped before a reply came
	// back. Please try asking again."* The connection was fine; what it hit was the time wall
	// — and "try again" is useless advice: the same question hits the same wall again.
	// Keep what's in hand distinct from what isn't: **have** this turn's retrieval/read counts
	// (the `SEARCHED 4 · READ 64` line already exists); **don't have** prose fit to show a
	// person — the evidence is raw tool output, and handing that over verbatim is exactly the
	// F-D-10 defect. So don't fabricate an answer; use the "each wall states its own reason"
	// approach (UX-84): give this turn its own stop reason, let the frontend render the match.
	if deadlineWall(ctx, err) {
		markRescueFailed(ctx, em, state, err)
		return false
	}
	em.sink.Error(err)
	return false
}

// deadlineWall —— is this ending "time ran out"? Either the turn's ctx has already expired, or
// the error itself is a deadline error.
func deadlineWall(ctx context.Context, err error) bool {
	return errors.Is(ctx.Err(), context.DeadlineExceeded) ||
		errors.Is(err, context.DeadlineExceeded)
}

// surfaceInsteadOfForce —— the two cases where the boundary must NOT attempt a synthesis:
//   - a real ANSWER already reached the visitor and this is a genuine fault (non-maxIter):
//     surface it; don't paper over a mid-stream provider failure. Checked on product, not
//     merged text — planning narration alone is not "an answer" (F-A-4 P1).
//   - the turn deadline died with ZERO evidence: the provider is hung/dead (evidence would
//     prove it was answering), so don't prolong the visitor's wait with another call.
func surfaceInsteadOfForce(ctx context.Context, state *turnState, err error) bool {
	if !errors.Is(err, adk.ErrExceedMaxIterations) && state.product != "" {
		return true
	}
	// Rate-limited (past the turn's wait budget, or the provider's own 429 after our retries):
	// a synthesis call would hit the same wall.
	if IsRateLimited(err) {
		return true
	}
	return ctx.Err() != nil && len(state.evidence) == 0
}

// The rescue call itself (forceFinalAnswer, its timeout and nudge) lives in
// agent_loop_force_final.go.
