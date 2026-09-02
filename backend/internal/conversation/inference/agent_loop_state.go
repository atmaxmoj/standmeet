// agent_loop_state.go —— the state a turn accumulates as it goes, plus the small operations
// that mutate it. Split out of agent_loop.go to keep under the 350-line cap; that file is left
// with only "consume events → wrap up".

package inference

import "github.com/cloudwego/eino/schema"

// turnState —— the state consumeAgentEvents accumulates as it goes. stop is the translated ADK
// FinishReason; assistantText is all of this turn's assistant-stream text (accumulated text
// deltas + snapshots).
//
// PROCESS vs PRODUCT (F-A-4 P1): text streamed in a round that ends WITH tool calls is the
// model narrating its plan — process, never the answer. Only rounds that end WITHOUT tool
// calls contribute to `product` (gates-are-necessary-conditions: in every successful turn the
// real answer is the tool-less tail). roundText accumulates the current round; flushRound
// classifies it at the round seam. Downstream consumers of "the answer" (ghost policy, the
// budget boundary's has-an-answer check) read product, not the merged blob.
type turnState struct {
	stop          string
	assistantText string
	roundText     string
	product       string
	// okTools —— which tools returned a NON-failing result this turn. Unbounded on purpose:
	// `evidence` drops its middle on a long crawl, and a receipt that can be evicted is not a
	// receipt. Read by the claim gate (F-A-37) to decide whether the answer's claim is backed.
	okTools map[string]bool
	// evidence —— the tool results gathered this turn (bounded head+tail). Carried into the
	// budget-exhaustion synthesis so a long crawl's findings survive the boundary.
	// evidenceTotal counts ALL results, so the digest can say the record is partial.
	evidence      []gatheredEvidence
	evidenceTotal int
	// inTokens/outTokens —— #106 billing: token totals across every LLM call in this turn's
	// react-loop (eino ResponseMeta.Usage). Handed to RecordUsage at the end.
	inTokens  int
	outTokens int
	// cachedTokens —— the portion of inTokens that hit cache (the only sub-breakdown the
	// upstream provider reports separately). It's **already counted** inside inTokens; it's
	// recorded separately only so the owner can see where the cost actually went.
	cachedTokens int
	// forcedFinal / recovered —— the boundary's no-tool synthesis: was it sent, was it
	// rescued. forcedFinal prevents a second send (both paths would otherwise want to add
	// one); recovered decides the closing word given to the visitor, because "the budget ran
	// out" and "the budget ran out but the answer was rescued" aren't the same thing (F-A-40).
	forcedFinal bool
	recovered   bool
}

// endAssistantRound —— a streaming assistant round hit EOF: classify its text (tool-suffixed
// = process, tool-less = product) and emit the accumulated tool starts.
func endAssistantRound(em *loopEmit, accum *assistantAccum, state *turnState) {
	if len(accum.calls) > 0 {
		discardRoundText(state)
	} else {
		commitRoundText(state)
	}
	emitToolStarted(em, accum)
}

// commitRoundText —— the round ended WITHOUT tool calls: its text is answer text (product).
func commitRoundText(state *turnState) {
	state.product += state.roundText
	state.roundText = ""
}

// discardRoundText —— the round ended WITH tool calls: its text was planning narration
// (process, never the answer); drop it from product.
func discardRoundText(state *turnState) {
	state.roundText = ""
}

// accumUsage —— #106: accumulates one LLM response's token usage into the turn (the react-loop
// calls it multiple times, and each call adds on).
func accumUsage(state *turnState, meta *schema.ResponseMeta) {
	if meta == nil || meta.Usage == nil {
		return
	}
	state.inTokens += meta.Usage.PromptTokens
	state.outTokens += meta.Usage.CompletionTokens
	state.cachedTokens += meta.Usage.PromptTokenDetails.CachedTokens
}
