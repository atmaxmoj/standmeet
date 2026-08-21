// bulkskill.go —— 一个**结果大到能把上下文顶过阈值**的 owner skill。
//
// 账（F-D-10）：prod 上两个外部 MCP 工具回了 374871 + 3505 字节，紧接着日志
// `context compacted before_msgs:5 after_msgs:2`，然后 AI 那一轮整段只有
// *"I'm here — what would you like to dig into next?"* —— 问题没答。
//
// 机制在 agent_compaction.go：压缩收尾 `tailPlainTurns` **必然**丢掉工具痕迹（留下
// 半条 tool 结果而它的调用没了，provider 会拒收整个请求）。所以那次工具返回的实质
// 只有一个地方能带走 —— 那份摘要。任务书第 6 条就是为它写的。
//
// 这个 fixture 就是那个"大工具结果"：一份一次读完就越过 32K 阈值的外部尽调报告，
// 里面埋着**只此一处**的两个事实。压缩之后那一轮还答不答得出它们，是这条 eval 判的。
// 只能用真模型判：替身不会真做摘要（回声里什么都在），在那一侧这条断言无条件为真。
package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// 报告里**只此一处**的两个事实。压缩之后问的就是它们；
// 填充段里绝不允许出现这两个串（否则断言判的是填充，不是召回）。
const (
	dossierThroughputFact = "4.7 million transactions per day"
	dossierOutageFact     = "41 minutes"
)

// dossierTargetChars —— 报告正文长度。
//
// 这个数是**判据的一部分**，不是随手填的：
//   - 第一次模型调用还没有 usage 可参考，eino 按 chars/4 估（estimateTokenCount）。
//     leg 的历史 88K 字符 ≈ 22K token，加 system + tool 声明（量出来 4K+）仍在 32K
//     以下 —— 所以第一次调用**不**触发压缩，工具因此有机会先跑。
//   - 这份报告 44K 字符 ≈ 11K token，接在真实 usage 后面越过 32K ——
//     所以压缩在**工具结果已经进窗口之后**才触发。那正是 prod 那次的形状。
//
// 两边各留了好几 K 的余量；shell 那条断言会亲自检查这个顺序，估错了会红在顺序上。
const dossierTargetChars = 44000

// dossierSkill —— owner 手里那份语料之外的外部报告，做成一个技能。
//
// 为什么是技能而不是外部 MCP：这条 eval 判的是**压缩带不带得走工具返回的实质**，
// 那跟工具从哪来无关；技能这条路不用另起一个进程，结果大小还完全由我们定。
func dossierSkill() *agentcore.VisitorSkillSpec {
	return &agentcore.VisitorSkillSpec{
		Name: "fetch_dossier",
		Description: "Fetch the full text of the Nimbus Data due-diligence dossier the owner keeps " +
			"outside the corpus. Call it whenever the visitor asks about the dossier, its throughput " +
			"figures, or the November outage — the numbers exist nowhere else.",
		Prompt: "You have a fetch_dossier skill that returns the full due-diligence dossier. " +
			"Call it before answering anything about the dossier's figures.",
		Language: "python",
		Content:  "print(open('dossier.txt').read())",
		Stdout:   dossierStdout(),
		Params: []agentcore.VisitorSkillParam{
			{Name: "section", Type: "string", Description: "section to fetch, or 'full'", Required: false},
		},
	}
}

// onceSpentStdout —— 一次性报告的第二次调用回什么。
//
// 说清楚「你已经取过了，那份文字只在这场对话里」，而不是丢一句「出错了」：
// 前者让模型据此决定要不要认账，后者只会让它重试。真实世界里的签名链接 / 过期报表
// 就是这么答的。
const onceSpentStdout = `{"error":"this dossier link was one-shot and has already been ` +
	`spent; the text fetched earlier in this conversation is the only copy"}`

// dossierStdout —— 技能打印出来的东西：一份 JSON 包着的长报告。
func dossierStdout() string {
	b, err := json.Marshal(map[string]string{
		"section": "full",
		"text":    dossierText(),
	})
	if err != nil { // Marshal 一个纯 string map 不会失败；真失败了就让它显形。
		panic(fmt.Sprintf("dossier marshal: %v", err))
	}
	return string(b)
}

// dossierFillerParas —— 填充段模板。措辞是**尽调报告**该有的样子，不是乱码：
// 摘要模型得有东西可压，压缩才是真的在做它平时做的事。
var dossierFillerParas = []string{
	"Section %d — Reconciliation coverage. The ledger pipeline replays each settlement window " +
		"against the acquirer statement and the internal journal, and files every unmatched leg " +
		"into a review queue that the on-call engineer clears within one business day. Coverage " +
		"held above 99 percent across the quarter, with the residue concentrated in cross-border " +
		"refunds where the acquirer reports a net amount and the journal keeps the gross.",
	"Section %d — Operational posture. Deploys go out behind a progressive rollout; the first " +
		"cohort is internal traffic only, the second is a single low-volume merchant, and the " +
		"remainder follows once the error budget for the window is untouched. Rollback is a single " +
		"command and is exercised on purpose once a month so that nobody meets it for the first " +
		"time during an incident.",
	"Section %d — Data retention. Settlement artefacts are kept hot for ninety days and cold for " +
		"seven years, which is what the payments regulator asks for in this market. Access to the " +
		"cold tier is broker-mediated and every read is attributed to a named person, so a request " +
		"for an old statement leaves a trail that survives staff turnover.",
	"Section %d — Vendor dependencies. Two acquirers, one card network gateway, and a fraud " +
		"scoring service sit on the critical path. Each has a documented degraded mode: the second " +
		"acquirer takes over routing within the same settlement window, the gateway falls back to " +
		"a batched submission, and the fraud service fails closed for high-value baskets only.",
}

// dossierText —— 报告正文：抬头 + 埋着两个事实的那一段 + 填充到目标长度。
func dossierText() string {
	var b strings.Builder
	b.WriteString("NIMBUS DATA — EXTERNAL DUE-DILIGENCE DOSSIER (confidential working copy)\n\n")
	b.WriteString("Section 1 — Platform scale and the November incident. " +
		"At the close of the last fiscal quarter the billing and payments platform sustained a peak of " +
		dossierThroughputFact + ", measured at the settlement boundary rather than at the edge. " +
		"The only customer-visible interruption in that period began on 3 November, when a schema " +
		"migration held a lock on the settlement table for longer than the deploy window allowed; " +
		"authorisations continued but capture was queued, and the interruption lasted " +
		dossierOutageFact + " end to end. Neither figure appears in any public filing.\n\n")
	for i := 2; b.Len() < dossierTargetChars; i++ {
		para := dossierFillerParas[(i-2)%len(dossierFillerParas)]
		b.WriteString(fmt.Sprintf(para, i))
		b.WriteString("\n\n")
	}
	return b.String()
}
