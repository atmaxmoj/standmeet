// visitor_chat_stream.go —— streamReply：跑 server-side agent loop。
//
// D-1+ 起 backend inference 缩到只剩 StreamSingleTurn (provider 不再嵌
// agent loop)；agent loop 改在这里跑：
//   for iter in 0..maxIter:
//     events := provider.StreamSingleTurn(ctx, ChatRequest{messages})
//     text, toolCalls := drainEvents(events) // text deltas → out token
//     if no toolCalls: emit done; return
//     for each tc: exec via binding; append messages
//
// 这是 /messages route 的服务器侧 agent loop；browser pi-agent-core
// (useConversation 走的 /inference/stream) 路径不经过这里。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/inference"
)

const maxServerAgentTurns = 8

// streamArgs —— streamReply 的入参打包；revive 限制函数最多 5 个参数。
type streamArgs struct {
	provider inference.Provider
	deps     *VisitorDeps
	in       *SendMessageInput
	out      chan<- MessageEvent
	bindings []*agentskills.Binding
}

func streamReply(ctx context.Context, args *streamArgs) {
	defer close(args.out)
	defer releaseQuerySlot(args.deps, args.in.ConversationID)
	defer closeBindings(args.bindings)
	full, ok := runServerSideAgentLoop(ctx, args)
	if !ok {
		return
	}
	args.out <- emitDoneEvent(ctx, &doneInput{
		deps: args.deps, in: args.in, full: full, bindings: args.bindings,
	})
}

// runServerSideAgentLoop —— iter loop 把 LLM single-turn + tool execution
// 串起来。返 (累积 text, ok)；ok=false 已 emit error event。
func runServerSideAgentLoop(
	ctx context.Context, args *streamArgs,
) (string, bool) {
	state := &serverLoopState{
		system: buildSystemPrompt(ctx, args),
		tools:  bindingToolSpecs(args.bindings),
		exec:   makeChatExecutor(args.bindings),
		msgs:   []inference.Message{{Role: "user", Content: args.in.Body}},
	}
	for range maxServerAgentTurns {
		step := stepServerLoop(ctx, args, state)
		if !step.OK {
			return "", false
		}
		if step.Done {
			return state.fullText, true
		}
	}
	args.out <- MessageEvent{
		Kind: streamEvError,
		Err:  fmt.Errorf("agent loop: max turns (%d) exceeded", maxServerAgentTurns),
	}
	return "", false
}

type serverLoopState struct {
	exec     inference.ToolExecutor
	system   string
	fullText string
	msgs     []inference.Message
	tools    []inference.ToolSpec
}

func buildSystemPrompt(ctx context.Context, args *streamArgs) string {
	in := sendMsgToAssembleInput(args.in)
	return args.deps.AgentSkills.ComposeSystemPrompt(
		ctx, ComposeBasePersona(args.in.RoleSnapshot), in,
	)
}

// stepServerLoop —— 跑一次 LLM single-turn + 收 text + tool_calls。返
// (done, ok)。done=true 表示本轮无 tool_call (终态)；ok=false 表示出错
// 已 emit。
// stepResult —— stepServerLoop 返值结构 (避开 (bool, bool) confusing-results
// + 命名 return 被 nonamedreturns 禁的双重夹击)。
type stepResult struct {
	Done bool
	OK   bool
}

// stepServerLoop —— Done=true 本轮无 tool_call (终态)。OK=false 出错已
// emit error event。
func stepServerLoop(
	ctx context.Context, args *streamArgs, state *serverLoopState,
) stepResult {
	events, err := args.provider.StreamSingleTurn(ctx, &inference.ChatRequest{
		System:   state.system,
		Messages: state.msgs,
		Tools:    state.tools,
	})
	if err != nil {
		args.out <- MessageEvent{Kind: streamEvError, Err: err}
		return stepResult{Done: false, OK: false}
	}
	turn, ok := drainStreamEvents(events, args.out)
	if !ok {
		return stepResult{Done: false, OK: false}
	}
	state.fullText += turn.text
	if len(turn.toolCalls) == 0 {
		return stepResult{Done: true, OK: true}
	}
	state.msgs = appendAgentTurn(ctx, state.msgs, turn, state.exec)
	return stepResult{Done: false, OK: true}
}

type turnResult struct {
	text      string
	toolCalls []inference.StreamToolCall
}

// drainStreamEvents —— 消费一轮 StreamSingleTurn 的 channel，把 text
// 当 token 事件转发，记下 tool_calls。done/error 后退出。
func drainStreamEvents(
	events <-chan inference.StreamEvent, out chan<- MessageEvent,
) (*turnResult, bool) {
	r := &turnResult{}
	for ev := range events {
		if stop := drainOneEvent(&ev, r, out); stop {
			return drainResult(r, &ev)
		}
	}
	return r, true
}

const (
	streamEvText     = "text"
	streamEvToolCall = "tool_call"
	streamEvDone     = "done"
	streamEvError    = "error"
)

func drainOneEvent(
	ev *inference.StreamEvent, r *turnResult, out chan<- MessageEvent,
) bool {
	if accumulateEvent(ev, r, out) {
		return false
	}
	return terminalEvent(ev, out)
}

func accumulateEvent(
	ev *inference.StreamEvent, r *turnResult, out chan<- MessageEvent,
) bool {
	if ev.Type == streamEvText {
		r.text += ev.Text
		out <- MessageEvent{Kind: "token", Text: ev.Text}
		return true
	}
	if ev.Type == streamEvToolCall && ev.ToolCall != nil {
		r.toolCalls = append(r.toolCalls, *ev.ToolCall)
		return true
	}
	return false
}

func terminalEvent(ev *inference.StreamEvent, out chan<- MessageEvent) bool {
	if ev.Type == streamEvError {
		out <- MessageEvent{Kind: streamEvError, Err: ev.Err}
		return true
	}
	return ev.Type == streamEvDone
}

func drainResult(r *turnResult, ev *inference.StreamEvent) (*turnResult, bool) {
	if ev.Type == streamEvError {
		return nil, false
	}
	return r, true
}

// appendAgentTurn —— 把 assistant text + 各 tool_result 串成 messages 追加。
// tool_result 用 "[tool_result:<name>] <json>" 的 wire 表示 (跟前端
// agent-core toolResultAsMessage 同 prefix，mock_single_turn 也按此 parse)。
func appendAgentTurn(
	ctx context.Context,
	msgs []inference.Message, turn *turnResult,
	exec inference.ToolExecutor,
) []inference.Message {
	msgs = append(msgs, inference.Message{
		Role: "assistant", Content: assistantTurnContent(turn),
	})
	for i := range turn.toolCalls {
		result := execOneTool(ctx, exec, &turn.toolCalls[i])
		msgs = append(msgs, inference.Message{
			Role:    "user",
			Content: "[tool_result:" + turn.toolCalls[i].Name + "] " + result,
		})
	}
	return msgs
}

func assistantTurnContent(turn *turnResult) string {
	if turn.text != "" {
		return turn.text
	}
	// 无 text 但有 tool_use；占位 1 个空字符串避免空 content 被 provider 拒。
	return " "
}

func execOneTool(
	ctx context.Context, exec inference.ToolExecutor, tc *inference.StreamToolCall,
) string {
	out, terr := exec(ctx, tc.Name, tc.Input)
	if terr != nil {
		errBody, mErr := json.Marshal(map[string]string{"error": terr.Error()})
		if mErr != nil {
			return `{"error":"marshal failed"}`
		}
		return string(errBody)
	}
	return out
}

// sendMsgToAssembleInput —— SendMessageInput → AssembleInput 浅拷贝。
// registry.AssembleVisitor / ComposeSystemPrompt 共用。
func sendMsgToAssembleInput(in *SendMessageInput) *agentskills.AssembleInput {
	return &agentskills.AssembleInput{
		RoleSnapshot:   in.RoleSnapshot,
		MaxBookings:    in.MaxBookings,
		OwnerID:        in.OwnerID,
		Mode:           in.Mode,
		CodeID:         in.CodeID,
		VisitorName:    in.VisitorName,
		ConversationID: in.ConversationID,
	}
}

// bindingToolSpecs —— flatten []*Binding 里所有 BindingTool.Spec。
func bindingToolSpecs(bindings []*agentskills.Binding) []inference.ToolSpec {
	out := make([]inference.ToolSpec, 0, len(bindings))
	for _, b := range bindings {
		for _, t := range b.Tools {
			out = append(out, t.Spec)
		}
	}
	return out
}

func closeBindings(bindings []*agentskills.Binding) {
	for _, b := range bindings {
		if b.Close != nil {
			b.Close()
		}
	}
}

// makeChatExecutor —— 走 registry bindings 的 lookup-by-name。匹中即调对应
// executor；找不到返 errJSON (LLM 看到 "unknown tool" 自然 fallback)。
func makeChatExecutor(bindings []*agentskills.Binding) inference.ToolExecutor {
	return func(ctx context.Context, name string, input []byte) (string, error) {
		if exec := lookupBindingTool(bindings, name); exec != nil {
			return exec(ctx, name, input)
		}
		return errJSON("unknown tool: " + name), nil
	}
}

func lookupBindingTool(
	bindings []*agentskills.Binding, name string,
) inference.ToolExecutor {
	for _, b := range bindings {
		for _, t := range b.Tools {
			if t.Spec.Name == name {
				return t.Execute
			}
		}
	}
	return nil
}

// pumpChunks / Provider.Stream / Chunk 已删 (D-5 后 backend agent loop
// 走 server-side StreamSingleTurn 循环；不再有 Chunk 类型的 token 流)。

var _ = strings.Join // keep strings import alive for future use
