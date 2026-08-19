// agent_stop.go —— **这一轮怎么收场，以及告诉访客哪个词**。
//
// 从 agent_loop_budget.go 拆出来（那个文件撞了 max-lines 闸门，而闸门要的是拆包不是豁免）：
// 那边讲的是「预算怎么用完的」，这边讲的是「用完之后这一轮叫什么名字」—— 两件事的读者不同，
// 一个是运维看日志，一个是访客看屏幕。
//
// 停止原因每加一种，`proxy_wire.go` 的 `productStops` 也要认得它，否则会被 mapFinishReason
// 的 default 静默改写成「说完了」（F-A-35 就是这么漏的）。那份名单只有一处。

package inference

// StopNoAnswer —— 停止原因：这一轮**一个字都没答出来**，而且救不回来（F-A-35）。
//
// 为什么它必须是独立的一种，而不是复用 max_tokens / tool_use：那两个说的是**怎么停的**，
// 而访客要知道的是**结果是什么**。「说了一半」和「一个字没说」对他意味着不同的下一步 ——
// 前者可以问「剩下的呢」，后者只能重问一个更小的问题。产品以前对这两种说同一句
// 「ask for the rest」，于是在没有 rest 的时候许诺了一个 rest。
const StopNoAnswer = "no_answer"

// StopDeadline —— 停止原因：**时间用完了**，而且连边界那次救场也没来得及（F-A-44）。
//
// 跟 StopNoAnswer 分开，是因为访客要采取的动作不同：这一种该问得更窄，而不是「再问一次」。
// prod 上的现场：读了 64 条笔记、边界点着了、救场那 60 秒也用完，然后访客读到
// "The connection dropped before a reply came back. Please try asking again." ——
// 连接好好的，而「再问一次」会撞同一堵墙。
const StopDeadline = "deadline"

// doneStop —— 交给访客那一侧的收场词。
//
// 四条分支，各自对应访客手里**不同的东西**：
//   - 说了自己办成一件事却没有回执 → `claim_unbacked`（压过全部，F-A-37）
//   - 时间用完、连救场都没来得及 → `deadline`（F-A-44）
//   - 救回来了 → 有一个完整答案 → `end_turn`（不能再说 max_tokens：没有 rest 可问了）
//   - 没救回来、正文是空的 → **手里什么都没有** → `no_answer`
//   - 其余 → 原样透传（正文在，只是没说完）
//
// 判据落在 `product == ""` 而不是某个具体 stop reason：任何「正常收场却没有产物」的结局
// 都是同一件事，不该等下一种 finish_reason 出现时再补一遍（[[lesson-not-swept-to-neighbours]]，
// 跟 ensureProduct 里那个条件同源）。
//
// 日志那边照旧记真实的 stop + recovered，两个读者要的东西不一样。
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
