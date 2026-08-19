// agent_compaction.go —— 上下文压缩：**压掉什么、必须留住什么**。
//
// 账（F-A-45）：真模型跑一段 39K token 的长对话，压缩确实触发了（`before_msgs=276
// after_msgs=2`），然后 agent 答得像对话刚开始 —— 面试官的名字、公司、岗位、团队，
// 一个都想不起来。而这些全在开头。
//
// ②🎯 两处都是「我们没说」：
//   - `Config.UserInstruction` 空着 → 用的是库自带的通用摘要指令。它不可能知道
//     StandMeet 的一轮对话里**哪些事实是不能丢的**：访客说自己是谁、他为什么来、
//     产品答应过他什么。
//   - `Config.Finalize` 空着 → `DefaultFinalize` 只留 system + 一条摘要。也就是说
//     最近那几轮的**原话**也没了，全靠摘要转述。
//
// 所以两样都给：说清要保住什么，再把最近几轮原样留着 —— 摘要写砸了也还有原话兜底。

package inference

import (
	"context"
	"fmt"

	"github.com/cloudwego/eino/adk/middlewares/summarization"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// keepTailTurns —— 压缩之后原样保留的**最近**几条问答。
//
// 为什么不只靠摘要：摘要是转述，而访客上一句里的指代（「那个」「他」「刚说的那条」）
// 只在原话里解得开。留几条最贵的一段，比让摘要试图复述它便宜也可靠。
const keepTailTurns = 6

// compactionUserInstruction —— 交给摘要模型的任务说明。
//
// 措辞照着「访客那一侧会因为丢了什么而受伤」写，而不是泛泛地说「保留要点」：
// 前者能判负（丢了名字就是丢了），后者写完等于没写。
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

Write it as plain prose. Do not call any tools.`

// summarizationConfig —— 压缩中间件的配置。Model 由 caller 填。
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

// finalizeKeepingTail —— 库的默认收尾（system + 摘要），后面再接上最近几条原话。
func finalizeKeepingTail(
	ctx context.Context, original []*schema.Message, summary *schema.Message,
) ([]*schema.Message, error) {
	base, err := summarization.DefaultFinalize(ctx, original, summary)
	if err != nil {
		return nil, fmt.Errorf("compaction finalize: %w", err)
	}
	return append(base, tailPlainTurns(original, keepTailTurns)...), nil
}

// tailPlainTurns —— 取最后 n 条**纯文本**的 user/assistant 消息。
//
// 刻意跳过带 tool_calls 的助手消息和 tool 结果：把一条 tool 结果留下来而它的调用已经
// 被压掉，provider 会拒收整个请求。留原话是为了解指代，不是为了留工具痕迹。
func tailPlainTurns(msgs []*schema.Message, n int) []*schema.Message {
	out := make([]*schema.Message, 0, n)
	for i := len(msgs) - 1; i >= 0 && len(out) < n; i-- {
		if isPlainTurn(msgs[i]) {
			out = append(out, msgs[i])
		}
	}
	// 上面是从后往前收的，翻回时间顺序。
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// isPlainTurn —— 一条**能单独留下来**的问答：有正文、不带工具痕迹、是人或 AI 说的话。
func isPlainTurn(m *schema.Message) bool {
	return m != nil && m.Content != "" && !carriesToolTrace(m) && isDialogueRole(m.Role)
}

// carriesToolTrace —— 这条消息是不是工具往返的一半（调用或结果）。
// 留下半条会让 provider 拒收整个请求，所以两半都不留。
func carriesToolTrace(m *schema.Message) bool {
	return len(m.ToolCalls) > 0 || m.ToolCallID != ""
}

func isDialogueRole(r schema.RoleType) bool {
	return r == schema.User || r == schema.Assistant
}
