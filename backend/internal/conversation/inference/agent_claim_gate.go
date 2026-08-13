// agent_claim_gate.go —— F-A-37：一轮答案宣称完成了某个动作，这一轮就必须有那个工具的成功
// 回执，否则宿主判这一轮不算数。
//
// 为什么需要装置而不是一句 prompt：真实环境里，连约四场之后第五次的回答是 *"Booked. ✅
// Monday, August 31 · 13:00–13:30 UTC … Invite went to …"*，那一轮**一个工具都没调**，真日历
// 整天空的。浏览器回放的历史只有 `{role, content}` —— 模型读回去的是四条自己写过的
// "Booked"，看不见任何工具痕迹，于是要补全的成了**那句话**。prompt 里加一句「不要编」只是把
// 概率往下压一点；能力做的是「发生了 / 没发生」的动作，判据必须是回执。
//
// 内核这一侧只认两样东西：本轮哪些工具**成功**回过、以及能力声明的那几句「完成态」说法。
// 它不知道 booking 是什么（gates 由能力在 manifest 里声明，装配期带进来）。

package inference

import (
	"log/slog"
	"strings"
)

// StopClaimUnbacked —— 停止原因：这一轮说自己做成了一件事，却没有那件事的回执。
//
// 它跟 end_turn / max_tokens 并列走同一条通道（`done` 帧的 stop），因为客户端**已经**在按
// stop 决定这一轮怎么收场（F-A-34 的截断提示就走这条）。访客那边渲的是产品自己的话，不是
// 模型的 —— 那句已经流出去的 "Booked" 收不回来，但「这一轮算不算数」由产品判。
const StopClaimUnbacked = "claim_unbacked"

// ClaimGate —— 带进这一轮的必要条件。Tool 有成功回执 = 这类主张有据。
type ClaimGate struct {
	Tool    string
	Phrases []string
}

// claims —— 这段答案有没有断言动作已完成（小写子串）。
func (g *ClaimGate) claims(answer string) bool {
	low := strings.ToLower(answer)
	for _, p := range g.Phrases {
		if p != "" && strings.Contains(low, strings.ToLower(p)) {
			return true
		}
	}
	return false
}

// applyClaimGate —— 收尾判一次：主张没有回执 → 这一轮的收场由产品改写，并留一行日志说明
// 是哪个工具缺了回执（不留的话，运维只会看到一个正常收尾的 turn）。
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

// unbackedClaim —— 本轮违反的那道闸（没有则 nil）。
//
// 判据是**必要条件**，不是「模型说得对不对」：答案里有完成态的说法、而本轮该工具没有成功
// 回执 → 这一轮不算数。反过来不闸：调了工具却没说，或者只是提议/提问，都不是主张。
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

// violates —— 这一道闸被这一轮违反了吗。声明不全的闸不判（判不了时「不闸」比「瞎闸」对）。
func violates(g *ClaimGate, answer string, okTools map[string]bool) bool {
	if g.Tool == "" || len(g.Phrases) == 0 {
		return false
	}
	return g.claims(answer) && !okTools[g.Tool]
}

// markToolOK —— 记下「这个工具本轮成功回过一次」。失败的回执不算回执：能力的错误约定是
// `{"ok":false,...}`，那种回执支撑不了「已经完成」。
//
// 单独记一份而不是复用 evidence：evidence 是**有上限**的（长爬时头尾保留、中段丢弃），拿它
// 当回执会让一轮工具很多的会话里，闸门凭空放行。
func markToolOK(state *turnState, tool, result string) {
	if tool == "" || toolResultFailed(result) {
		return
	}
	if state.okTools == nil {
		state.okTools = map[string]bool{}
	}
	state.okTools[tool] = true
}

// toolResultFailed —— 回执自称失败了吗。各能力统一的错误约定是顶层 `"ok": false`。
func toolResultFailed(result string) bool {
	compact := strings.ReplaceAll(result, " ", "")
	return strings.Contains(compact, `"ok":false`)
}
