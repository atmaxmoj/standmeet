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
	"os"
	"strconv"
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
		markRescueFailed(ctx, em, state, nil)
		return
	}
	em.sink.Text(recovered)
	state.assistantText += recovered
	state.product += recovered
	state.recovered = true
}

// markRescueFailed —— **边界点着了、救场也没救回来**，那这一轮叫什么名字。
//
// 通向这里的有两扇门：`handleTerminalError`（循环以 error 收场）和 `ensureProduct`
// （循环正常收场但没有产物）。prod 上抓到的是前者，而 e2e 里复现出来的是后者 ——
// 我第一次只补了前者，用例照旧红，日志里那行 `forcing final answer` 根本不在
// （[[lesson-not-swept-to-neighbours]]）。判决因此收在这一处，两扇门都走它。
//
// 时间用完是**一种特定的收场**，不是一次故障：访客该问得更窄，而不是「再问一次」。
// 其余情况保持原样（error 帧 / no_answer），这里不越权。
func markRescueFailed(ctx context.Context, em *loopEmit, state *turnState, err error) {
	if !deadlineWall(ctx, err) {
		return
	}
	em.log.Warn("agent turn: boundary synthesis also ran out of time",
		"evidence_items", len(state.evidence))
	state.stop = StopDeadline
}

// 停止原因（StopNoAnswer / StopDeadline）和 doneStop 住在 agent_stop.go —— 那边讲
// 「这一轮叫什么名字」，这个文件讲「预算怎么用完的」，两个读者不一样。

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
	// 救场也没救回来。**这仍然不是「连接断了」**（F-A-44）：prod 上量到过一次 —— 读了 64 条
	// 笔记、边界点着、救场那 60 秒也用完，然后访客读到 *"The connection dropped before a reply
	// came back. Please try asking again."* 连接好好的，撞的是时间墙；而「再问一次」是句没用的
	// 建议：同一个问题会撞同一堵墙。
	//
	// 这一刻手里有什么、没有什么，要分清：**有** 这一轮的检索/阅读计数（屏幕上那行
	// `SEARCHED 4 · READ 64` 已经在了）；**没有** 一段能给人看的散文 —— 证据是工具原始输出，
	// 原样倒给访客正是 F-D-10 那条缺陷。所以不编答案，改走「每堵墙自己说明理由」那套
	// （UX-84）：给这一轮一个自己的停止原因，前端渲对应的那句话。
	if deadlineWall(ctx, err) {
		markRescueFailed(ctx, em, state, err)
		return false
	}
	em.sink.Error(err)
	return false
}

// deadlineWall —— 这次收场是不是「时间用完了」。turn 的 ctx 已过期，或错误本身就是 deadline。
func deadlineWall(ctx context.Context, err error) bool {
	return errors.Is(ctx.Err(), context.DeadlineExceeded) ||
		errors.Is(err, context.DeadlineExceeded)
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
//
// 它自己也会用完（prod 上量到过：24 条证据、reasoning 模型，60 秒没够）。那条路上产品该说
// 什么由 handleTerminalError 收口 —— 见 StopDeadline。
const defaultForceFinalTimeout = 60 * time.Second

// FORCE_FINAL_TIMEOUT(秒)可覆盖 —— 跟 AGENT_TURN_TIMEOUT 一样，是给 e2e 用来**把边界
// 之后那条路也逼出来**的：两个预算都短，才走得到「救场也没救回来」那一格。
func forceFinalTimeout() time.Duration {
	if s := os.Getenv("FORCE_FINAL_TIMEOUT"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return defaultForceFinalTimeout
}

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
