// agent_loop_tools.go —— tool_call accumulation during assistant streaming in the agent loop,
// plus the end-of-stream emit. Extracted from agent_loop.go (to cut line count); serves only the
// routeMessageVariant consumption chain.

package inference

import (
	"encoding/json"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/schema"
)

// assistantAccum —— accumulates the tool_calls inside an assistant message during streaming.
// eino returns ToolCall.Function.Arguments incrementally per chunk; aggregated by Index, then
// emitted as complete ToolStarted events once at stream end.
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

// emitToolStarted —— at stream end, feeds every accumulated tool_call into the sink.
// progress_label is looked up via em.labels (H.11); missing → frontend falls back to
// "running <name>".
func emitToolStarted(em *loopEmit, accum *assistantAccum) {
	for _, pc := range accum.calls {
		args := pc.Args
		if args == "" {
			args = "{}"
		}
		// Tool-level logging: makes visible what step the agent is actually running
		// (corpus_read's path / search's query / ext / skill ...). Observability beyond the
		// turn-level start/done (#12).
		// call_id —— the same-named tool can be called multiple times within this turn (a
		// real model can dispatch several in one message); without it, start and done can't
		// be paired up (F-S-1). The id was already in hand — it was just never passed on to
		// the sink before.
		em.log.Info("agent tool start", "call_id", pc.ID, "name", pc.Name, "args", args)
		em.sink.ToolStarted(pc.ID, pc.Name, em.labels[pc.Name], json.RawMessage(args))
	}
}

// emitToolCompleted —— called when ADK sends a Role=Tool event; content is the string a tool's
// execution returned (a capability binding is typically a JSON envelope, parsed by the
// consumer itself).
func emitToolCompleted(em *loopEmit, mv *adk.MessageVariant, state *turnState) {
	msg, err := mv.GetMessage()
	if err != nil {
		em.log.Error("agent turn tool result message", logErrKey, err)
		return
	}
	// Completion log: call id + name + result byte count (the result can be large, e.g.
	// corpus_read's body — not logged in full).
	//
	// **call_id is the point of this line** (F-S-1). Name + byte count can't distinguish
	// parallel same-named calls: driving corpus-search once had `recursive convergence` and
	// its Chinese equivalent `递归收敛` dispatched together in one turn, one coming back empty
	// and the other 7883 bytes, with the two done lines otherwise identical — so "did the
	// Chinese-language query actually hit anything" became unanswerable from the logs. Byte
	// count can't serve as identity either: two calls can easily return the same number of
	// bytes.
	em.log.Info("agent tool done",
		"call_id", msg.ToolCallID, "name", mv.ToolName, "result_bytes", len(msg.Content))
	// Keep the finding: if this turn later exhausts its iteration budget, the forced
	// synthesis answers FROM this material instead of from an empty context.
	recordEvidence(state, mv.ToolName, msg.Content)
	// The receipt half of the claim gate (F-A-37): a tool that answered without failing is what
	// lets this turn's answer say the action happened.
	markToolOK(state, mv.ToolName, msg.Content)
	em.sink.ToolCompleted(mv.ToolName, msg.Content)
}
