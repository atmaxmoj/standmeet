// agent_loop_state.go —— 一个 turn 边走边累的状态，以及改它的那几个小动作。
// 从 agent_loop.go 拆出来守 350 行上限；驱动那边只剩「消费事件 → 收尾」。

package inference

import "github.com/cloudwego/eino/schema"

// turnState —— consumeAgentEvents 边走边累的转态。stop 是 ADK 给的
// FinishReason 翻译；assistantText 是本 turn assistant 流的全部文字
// (text delta + snapshot 累)。
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
	// inTokens/outTokens —— #106 计费:本 turn 跨 react-loop 每次 LLM 调用的 token 累计
	// (eino ResponseMeta.Usage)。收尾交给 RecordUsage。
	inTokens  int
	outTokens int
	// cachedTokens —— inTokens 里命中缓存的那部分(上游肯单独报的唯一一项细分)。
	// 它**已经算在** inTokens 里,记下来只是为了让 owner 看得出这笔账贵在哪。
	cachedTokens int
	// forcedFinal / recovered —— 边界那一次无 tool 合成:发过没有、救回来没有。
	// forcedFinal 防重发(两条路都会想补一次);recovered 决定给访客的收场词,
	// 因为「预算用完了」跟「预算用完但答案救回来了」不是同一件事(F-A-40)。
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

// accumUsage —— #106: 把一次 LLM 响应的 token 用量累进 turn(react-loop 会多调,累计)。
func accumUsage(state *turnState, meta *schema.ResponseMeta) {
	if meta == nil || meta.Usage == nil {
		return
	}
	state.inTokens += meta.Usage.PromptTokens
	state.outTokens += meta.Usage.CompletionTokens
	state.cachedTokens += meta.Usage.PromptTokenDetails.CachedTokens
}
