// agent_loop_budget.go —— the turn's ITERATION BUDGET and, more importantly, what happens when
// it runs out.
//
// The turn's contract with the visitor is ONE grounded, synthesized answer. Planning and tool
// chatter are process, not product. A real vault is a linked graph, so a broad question
// legitimately crawls deep — and ANY budget can be exhausted by a long enough chain. So the
// budget is only half the design; the boundary is the other half, and it lives here:
//
//   - maxAgentIterations —— sized for real linkage chains, not a toy.
//   - recordEvidence     —— every tool result is kept (bounded), so a crawl's findings survive.
//   - handleTerminalError/forceFinalAnswer —— when the loop ends with no answer, force ONE
//     tool-less call that synthesizes FROM the gathered evidence. Never hand the visitor raw
//     planning narration (F-A-4), never an empty frame, never "I have no specifics" right
//     after reading 26 notes.

package inference

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/cloudwego/eino/adk"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

// maxAgentIterations —— tool-calling rounds allowed per turn.
//
// The owner's vault is a linked GRAPH: answering a broad question legitimately crawls deep
// (search → read → follow [[links]] → read again), so this is sized for real linkage chains,
// not a toy. But it is a BUDGET, not a guarantee — ANY budget can be exhausted by a long
// enough chain. So raising it is necessary, never sufficient: what actually keeps the turn's
// contract with the visitor (one grounded, synthesized answer) is the exhaustion path below
// (handleTerminalError → forceFinalAnswer), which synthesizes from whatever WAS gathered.
const maxAgentIterations = 24

// Evidence budget for the exhaustion synthesis. The fallback is ONE model call, so the material
// carried into it must be bounded. WHICH results we keep is a real design choice: a pure
// recent-bias is wrong. The chain-exhaustion eval caught it — a 33-hop crawl pushed the chain's
// HEAD out of the window, and the model then told the visitor "I don't have a photosynthesis
// note" about a note that plainly exists. So keep BOTH ends and sacrifice the middle: the head
// is where the crawl started (what the visitor asked about), the tail is where it got deepest.
const (
	evidenceHeadCap = 8                                 // earliest results kept
	evidenceTailCap = 16                                // most recent results kept
	evidenceCap     = evidenceHeadCap + evidenceTailCap // total carried into the fallback
	evidenceItemCap = 2000                              // bytes kept per result
)

// gatheredEvidence —— one tool result collected during this turn. On budget exhaustion these
// are what the forced synthesis answers FROM, so a long crawl is never thrown away.
type gatheredEvidence struct {
	tool   string
	result string
}

// recordEvidence —— record a tool result (truncated on a rune boundary), keeping the crawl's
// head and its most recent tail; the middle is what gets sacrificed when the cap is hit.
// evidenceTotal keeps counting, so the digest can tell the model its record is PARTIAL rather
// than let it conclude a note doesn't exist.
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
	// strings.Builder 的 Write* 永不返错;显式弃返回值(revive unhandled-error)。
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

// logTurnStop —— 这一轮**为什么**结束。属于这个文件而不是驱动那边：这是预算耗尽的
// 第四种情形，而这份文件正是「预算只是一半，边界是另一半」的那一半。
//
// 前三种（迭代、超时、终止错误）走 handleTerminalError / forceFinalAnswer 收口。
// 第四种 —— 模型自己的**输出预算**用完 —— 不是 error：流正常关闭，正文停在半句上，
// 甚至一个字都没有。它在日志里曾经跟说完了的 turn 一模一样（F-A-34 把它记了下来），
// 而**收口是这一轮才补的**（F-A-40，见 ensureProduct）。`recovered` 一起记：
// 「预算用完了」和「预算用完但我们把答案救回来了」是两回事。
func logTurnStop(log *slog.Logger, state *turnState) {
	log.Info("agent turn stop",
		"stop", state.stop, "answer_chars", len(state.product), "recovered", state.recovered)
}

// ensureProduct —— **第四条路的边界**：流正常结束，而访客一个字都没拿到（F-A-40）。
//
// prod 上驱出来的样子：`SEARCHED 51 · READ 4` → 正文空白 → 一句「this answer was cut
// short — ask for the rest」，而根本没有 rest。日志是 `stop=max_tokens answer_chars=0`：
// 没撞超时、没撞迭代上限，是模型把**自己的输出预算**全花在工具调用上，一个字没写。
// 那不是 error，所以它绕过了 handleTerminalError，直接硬停。
//
// 判据第一句写着「**The boundary is engineered; a bigger budget is not a boundary**」——
// 而这条路上以前只有预算。这里补的就是那个边界：**证据早就攒好了**（51 次检索的结果都在
// `state.evidence` 里），所以走跟其它三条完全相同的收口 —— 一次无 tool 的合成。
//
// 条件写成 `product == ""` 而不是 `stop == "max_tokens"`：任何「正常收场却没有产物」的
// 结局都该被这道边界接住，而不是等下一种 finish_reason 出现时再补一遍
// （[[lesson-not-swept-to-neighbours]]）。
func ensureProduct(ctx context.Context, em *loopEmit, state *turnState) {
	if state.product != "" || state.forcedFinal {
		return
	}
	// 一次 tool 都没跑过、也没有任何证据：模型是**什么都没做就空手收场**。再发一次合成
	// 也只是让访客多等一次往返 —— 这跟 surfaceInsteadOfForce 里那条「provider 挂了就别
	// 再拖」是同一个判断。
	if len(state.evidence) == 0 {
		em.log.Warn("agent turn ended with no answer and no evidence", "stop", state.stop)
		return
	}
	em.log.Warn("agent turn ended with no answer; forcing synthesis from evidence",
		"stop", state.stop, "evidence_items", len(state.evidence))
	recovered := forceFinalAnswer(ctx, em, state)
	if recovered == "" {
		return
	}
	em.sink.Text(recovered)
	state.assistantText += recovered
	state.product += recovered
	state.recovered = true
}

// StopNoAnswer —— 停止原因：这一轮**一个字都没答出来**，而且救不回来（F-A-35）。
//
// 为什么它必须是独立的一种，而不是复用 max_tokens / tool_use：那两个说的是**怎么停的**，
// 而访客要知道的是**结果是什么**。「说了一半」和「一个字没说」对他意味着不同的下一步 ——
// 前者可以问「剩下的呢」，后者只能重问一个更小的问题。产品以前对这两种说同一句
// 「ask for the rest」，于是在没有 rest 的时候许诺了一个 rest。
const StopNoAnswer = "no_answer"

// doneStop —— 交给访客那一侧的收场词。
//
// 三条分支，各自对应访客手里**不同的东西**：
//   - 救回来了 → 有一个完整答案 → `end_turn`（不能再说 max_tokens：没有 rest 可问了）
//   - 没救回来、正文是空的 → **手里什么都没有** → `no_answer`
//   - 其余 → 原样透传（正文在，只是没说完）
//
// 判据落在 `product == ""` 而不是某个具体 stop reason：任何「正常收场却没有产物」的结局
// 都是同一件事，不该等下一种 finish_reason 出现时再补一遍（[[lesson-not-swept-to-neighbours]]，
// 跟 ensureProduct 里那个条件同源）。
//
// 日志那边照旧记真实的 stop + recovered，两个读者要的东西不一样。
//
// **claim gate 的判决压过全部**：那一轮说自己办成了一件事而拿不出回执（F-A-37），
// 这件事跟答案空不空、是不是救回来的都无关，访客那一侧必须照旧收到 claim_unbacked。
func doneStop(state *turnState) string {
	if state.stop == StopClaimUnbacked {
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

// recordTurnUsage —— #106: turn 收尾把累计 token 交给注入的 RecordUsage(有 cred/model + 有用量时)。
// nil recorder(无状态 smoke) / BYOAI(route 传 no-op) / 零用量 → 不记。
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

// handleTerminalError —— agent loop 以 error 收场。绝不把空回答交给 caller：一个字
// 都没出时（MaxIterations 死循环、模型幻觉出一个不存在的 tool 名、mid-stream 瞬时
// 抖动），强制再发一次**无 tool** 的 model call (forceFinalAnswer)，让模型用已有上下文
// 当场把话说完 —— 拿到 in-voice、persona-aware 的真实回答 / 认怂，而非空 / 错误帧。
// 真 provider 故障会让 Generate 也失败 → 透到 sink.Error（保留真错误行为）。已经流了
// 可用回答时：MaxIterations 当截断干净收尾（不补错误帧）；其它 error 仍 surface。
// 返 false 终止消费。stop 仍走默认 end_turn。
func handleTerminalError(
	ctx context.Context, em *loopEmit, state *turnState, err error,
) bool {
	maxIter := errors.Is(err, adk.ErrExceedMaxIterations)
	if surfaceInsteadOfForce(ctx, state, err) {
		em.sink.Error(err)
		return false
	}
	// Otherwise force a no-tool synthesis. On MaxIterations the model may have streamed
	// only planning narration ("Let me survey… Let me dig into…") and never synthesized —
	// that is NOT an answer (F-A-4). Force one so the visitor always gets a real reply;
	// this also covers the no-text cases (hallucinated tool name, mid-stream blip).
	em.log.Warn("agent turn forcing final answer", logErrKey, err,
		"evidence_items", len(state.evidence))
	state.forcedFinal = true // ensureProduct 不再补第二次(那只是多一次往返)
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
	em.sink.Error(err)
	return false
}

// surfaceInsteadOfForce —— the two cases where the boundary must NOT attempt a synthesis:
//   - a real ANSWER already reached the visitor and this is a genuine fault (non-maxIter):
//     surface it; don't paper over a mid-stream provider failure. The check is on product,
//     not merged text — planning narration alone is not "an answer" (F-A-4 P1).
//   - the turn deadline died with ZERO evidence: the provider itself is hung/dead (evidence
//     would prove it was answering), so don't prolong the visitor's wait with another call.
func surfaceInsteadOfForce(ctx context.Context, state *turnState, err error) bool {
	if !errors.Is(err, adk.ErrExceedMaxIterations) && state.product != "" {
		return true
	}
	return ctx.Err() != nil && len(state.evidence) == 0
}

// forceFinalTimeout —— the boundary synthesis's own budget. It must survive the turn's
// expired deadline (the time wall is exactly when it's needed), so it runs on a detached,
// bounded context — never unbounded, never the dead parent.
const forceFinalTimeout = 60 * time.Second

// forceFinalAnswer —— 无 tool 一次性收口:the turn's contract is ONE grounded answer, so when
// the loop ends without one (budget exhausted / bad tool name / mid-stream blip) we make one
// tool-less call that must produce it.
//
// Crucially it answers FROM the material this turn already gathered (evidenceDigest). A broad
// question over a big linked vault can burn the whole budget crawling; throwing those findings
// away would make the fallback say "I have no specifics" right after reading 26 notes — the
// worst possible boundary behaviour. grounding 规则仍在 system 里，所以无 evidence 时它仍会
// 认怂而非编造。失败返空，由 caller 收尾。
func forceFinalAnswer(ctx context.Context, em *loopEmit, state *turnState) string {
	if em.in == nil || em.in.Req == nil {
		return ""
	}
	// Detach from the (possibly expired) turn ctx: the forced synthesis is the boundary's
	// last act and gets its own short budget. Without this, a turn-timeout kills the very
	// call meant to rescue the gathered evidence (observed live: 26 retrievals → "That
	// took too long", everything discarded).
	fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), forceFinalTimeout)
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
	// 自己的输出预算（BoundaryMaxTokens）：默认那个 4096 在 reasoning 模型上会被思考
	// token 吃干净 —— prod 上量到过，边界点着了、40 秒之后回来一个空串、没有报错。
	// 救场的那一步不能跟它要救的那一步共用同一个额度（F-A-40 的 ⑤）。
	out, err := Generate(ctx, em.in.Cred, &ChatRequest{
		System: sys, Messages: msgs, MaxTokens: BoundaryMaxTokens,
	})
	if err != nil {
		em.log.Warn("agent turn force-final generate", logErrKey, err)
		return ""
	}
	return out
}

// forceFinalNudge —— the instruction that turns an exhausted crawl into an answer. It must
// forbid the two failure modes actually observed (F-A-4): narrating the process ("Let me
// survey…"), and promising to look further. With evidence it demands synthesis + honest
// incompleteness instead of a blanket "I don't know".
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
