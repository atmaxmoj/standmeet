// agent_compaction.go —— context compaction: **what gets compacted away, what must survive**.
//
// The bill (F-A-45): a real model run against a 39K-token long conversation, compaction did fire
// (`before_msgs=276 after_msgs=2`), and the agent then answered as if the conversation had just
// started — the interviewer's name, company, role, team, none of it recalled. All of it was near
// the start.
//
// Both gaps were things we never told it:
//   - `Config.UserInstruction` was left empty → falls back to the library's generic summarization
//     instruction. It has no way to know **which facts a StandMeet conversation cannot afford to
//     lose**: who the visitor said they are, why they came, what the product promised them.
//   - `Config.Finalize` was left empty → `DefaultFinalize` keeps only system + one summary
//     message. Which means the **verbatim text** of the most recent turns is gone too, entirely
//     at the mercy of the summary's paraphrase.
//
// So both get filled in: say plainly what must survive, then keep the most recent turns verbatim
// on top of the summary — a botched summary still has the original text as a backstop.

package inference

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/adk/middlewares/summarization"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// keepTailTurns —— how many **most recent** Q&A turns survive compaction verbatim.
//
// Why not rely on the summary alone: a summary is paraphrase, and a reference in the visitor's
// last message ("that one", "him", "what you just said") only resolves against the original
// wording. Keeping a few turns verbatim is cheaper and more reliable than asking the summary to
// reproduce them.
const keepTailTurns = 6

// compactionUserInstruction —— the task description handed to the summarization model.
//
// Worded around "what the visitor side gets hurt by losing", not a generic "keep the key
// points": the former is falsifiable (a lost name is a lost name), the latter is worthless
// advice once written down.
const compactionUserInstruction = `Condense the conversation so far into one compact record.

This is a visitor talking to an AI that speaks for a specific person (its owner).
The summary REPLACES the earlier turns, so anything you leave out is gone for good.

Carry these forward verbatim, as concrete facts, not as themes:
1. Who the visitor said they are — their name, their company, their role, and who
   they are here on behalf of. Never generalise these into "the visitor".
2. Why they came: the position they are hiring for, the decision they are making,
   the thing they are evaluating — with the specific names and numbers they used.
3. Anything the AI promised, booked, sent, or agreed to, and anything still owed.
4. Facts the visitor supplied that the corpus does not contain (dates, constraints,
   preferences, contact details) — these exist nowhere else once this summary
   replaces the transcript.
5. Anything the visitor corrected or objected to, so it is not repeated back at them.
6. What any tools returned — the passage that was read, the slots that came back, the
   page that was fetched — in enough substance to answer the question still in flight.
   The tool trace itself CANNOT survive this compaction (a tool result whose call has
   been compacted away makes the provider reject the whole request), so this summary is
   the only place that evidence can live. A turn that loses it ends with "what would you
   like to dig into next?" instead of the answer the visitor asked for.

Write it as plain prose. Do not call any tools.`

// summarizationConfig —— config for the compaction middleware. Model is filled in by
// the caller.
func summarizationConfig(
	cm model.ToolCallingChatModel, threshold int, onFire summarization.CallbackFunc,
) *summarization.Config {
	return &summarization.Config{
		Model:           cm,
		Trigger:         &summarization.TriggerCondition{ContextTokens: threshold},
		UserInstruction: compactionUserInstruction,
		Finalize:        finalizeKeepingTail,
		Callback:        onFire,
	}
}

// finalizeKeepingTail —— the library's default finish (system + summary), with the most recent
// turns appended verbatim afterward.
func finalizeKeepingTail(
	ctx context.Context, original []*schema.Message, summary *schema.Message,
) ([]*schema.Message, error) {
	base, err := summarization.DefaultFinalize(ctx, original, summary)
	if err != nil {
		return nil, fmt.Errorf("compaction finalize: %w", err)
	}
	return append(base, tailPlainTurns(original, keepTailTurns)...), nil
}

// tailPlainTurns —— take the last n **plain-text** user/assistant messages.
//
// Deliberately skips assistant messages carrying tool_calls and tool results: leaving a tool
// result behind whose call has already been compacted away gets the whole request rejected by
// the provider. The original text is kept to resolve references, not to preserve tool traces.
func tailPlainTurns(msgs []*schema.Message, n int) []*schema.Message {
	out := make([]*schema.Message, 0, n)
	for i := len(msgs) - 1; i >= 0 && len(out) < n; i-- {
		if isPlainTurn(msgs[i]) {
			out = append(out, msgs[i])
		}
	}
	// Collected back-to-front above; flip back into chronological order.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// isPlainTurn —— a turn that **can stand alone if kept**: has body text, carries no tool trace,
// and is spoken by the visitor or the AI.
func isPlainTurn(m *schema.Message) bool {
	return m != nil && m.Content != "" && !carriesToolTrace(m) && isDialogueRole(m.Role)
}

// carriesToolTrace —— is this message one half of a tool round trip (call or result)?
// Leaving one half behind gets the whole request rejected by the provider, so neither half is
// kept.
func carriesToolTrace(m *schema.Message) bool {
	return len(m.ToolCalls) > 0 || m.ToolCallID != ""
}

func isDialogueRole(r schema.RoleType) bool {
	return r == schema.User || r == schema.Assistant
}
