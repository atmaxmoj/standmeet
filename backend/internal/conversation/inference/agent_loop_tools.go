// agent_loop_tools.go —— agent loop 里 assistant streaming 期间的 tool_call
// 累积 + 流尾 emit。从 agent_loop.go 抽出(压行数);只服务 routeMessageVariant
// 那条消费链。

package inference

import (
	"encoding/json"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

// assistantAccum —— streaming 期间累积 assistant message 里的 tool_calls。
// eino chunk 增量返 ToolCall.Function.Arguments，按 Index 聚合，流尾一次
// emit 完整 ToolStarted。
type assistantAccum struct {
	calls map[int]*pendingToolCall
}

func newAssistantAccum() *assistantAccum {
	return &assistantAccum{calls: map[int]*pendingToolCall{}}
}

func accumulateAssistantToolCalls(calls []schema.ToolCall, accum *assistantAccum) {
	for i := range calls {
		idx := callIndex(&calls[i])
		pc, ok := accum.calls[idx]
		if !ok {
			pc = &pendingToolCall{}
			accum.calls[idx] = pc
		}
		if calls[i].ID != "" {
			pc.ID = calls[i].ID
		}
		if calls[i].Function.Name != "" {
			pc.Name = calls[i].Function.Name
		}
		pc.Args += calls[i].Function.Arguments
	}
}

// emitToolStarted —— 流尾把累积的 tool_call 全部灌 sink。progress_label
// 走 em.labels 查表 (H.11)；缺则前端 fallback "running <name>"。
func emitToolStarted(em *loopEmit, accum *assistantAccum) {
	for _, pc := range accum.calls {
		args := pc.Args
		if args == "" {
			args = "{}"
		}
		// tool 级日志:看清 agent 这一步在跑什么(corpus_read 的 path / search 的
		// query / ext / skill ...)。turn 级 start/done 之外的可观测性(#12)。
		em.log.Info("agent tool start", "name", pc.Name, "args", args)
		em.sink.ToolStarted(pc.ID, pc.Name, em.labels[pc.Name], json.RawMessage(args))
	}
}

// emitToolCompleted —— ADK 发 Role=Tool event 时调；content 是 tool
// 执行返回的字符串 (capability binding 一般是 JSON envelope，消费方
// 自己解)。
func emitToolCompleted(em *loopEmit, mv *adk.MessageVariant, state *turnState) {
	msg, err := mv.GetMessage()
	if err != nil {
		em.log.Error("agent turn tool result message", logErrKey, err)
		return
	}
	// 完成日志:名字 + 结果字节数(结果可能很大,如 corpus_read 的 body,不全打)。
	em.log.Info("agent tool done", "name", mv.ToolName, "result_bytes", len(msg.Content))
	// Keep the finding: if this turn later exhausts its iteration budget, the forced
	// synthesis answers FROM this material instead of from an empty context.
	recordEvidence(state, mv.ToolName, msg.Content)
	// The receipt half of the claim gate (F-A-37): a tool that answered without failing is what
	// lets this turn's answer say the action happened.
	markToolOK(state, mv.ToolName, msg.Content)
	em.sink.ToolCompleted(mv.ToolName, msg.Content)
}
