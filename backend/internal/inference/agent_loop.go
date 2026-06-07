// agent_loop.go —— transport-agnostic agentic core。把 H.9 的 eino ADK
// agent loop 从 HTTP/SSE 解耦：
//
//   - BuildAgentIterator —— pre-stream：建 chat model + summarization mw +
//     ADK ChatModelAgent + runner，返事件 iterator。
//   - DriveAgentLoop     —— 消费 iterator，把事件灌进一个 AgentSink；
//     收尾跑 H.13 follow-up suggestions + Done。不碰 http。
//
// prod (RunAgentTurn) 注入 sseSink 写浏览器 pi SSE；eval-harness 注入
// transcript sink 审真实行为。loop 一字不差共享，AgentSink 是唯一注入点
// (对应原 D/F 设计里 agent-core 的 EventObserver port，只是落在 backend
// Go loop 上)。

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/adk/middlewares/summarization"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// contextTokenThreshold —— H.9b: ChatModelAgent 的 summarization
// middleware 触发阈值。按 [[feedback-no-anthropic-assumption]] 取最
// 小可行 provider 偏保守的数：DeepSeek-V3 64K / GPT-4o 128K / Claude
// 200K 都富余；Llama 8K local 会早 compact 但不会撞 provider 上限。
const contextTokenThreshold = 32000

// AgentSink —— agent loop 的事件出口 (observer)。loop 只对这个接口编程，
// 不知道运行在 http handler 还是 eval-harness 进程里：
//
//   - prod: sseSink (agent_turn.go) 把每条事件写成 pi SSE 帧给浏览器
//   - eval: harness 给个 transcript sink，打印 / 落 JSONL 审 prompt + 行为
//
// 方法语义跟 pi SSE event 一一对应；progressLabel 由 caller 查好传入
// (H.11 throbber 文案)，sink 不自己查表。
type AgentSink interface {
	Text(delta string)
	ToolStarted(id, name, progressLabel string, args json.RawMessage)
	ToolCompleted(name, result string)
	Suggestions(items []string)
	Error(err error)
	Done(stop string)
}

// loopEmit —— consume 链共用的小包 (log + sink + labels)，避开多参
// (revive 5-arg 上限)。labels 给 emitToolStarted 查 progress_label。
type loopEmit struct {
	log    *slog.Logger
	sink   AgentSink
	in     *AgentTurnInput // for the max-iterations tool-less fallback
	labels map[string]string
}

// BuildAgentIterator —— pre-stream：建 chat model + summarization mw +
// ADK ChatModelAgent + runner，返事件 iterator。失败 (cred / model build /
// msg 解析) 在写任何事件之前返回，caller 决定怎么报 (HTTP status vs
// transcript)。
func BuildAgentIterator(
	ctx context.Context, in *AgentTurnInput,
) (*adk.AsyncIterator[*adk.AgentEvent], error) {
	cm, err := BuildChatModel(ctx, pickModelCred(in.Cred, in.Req.Model))
	if err != nil {
		return nil, fmt.Errorf("eino: build chat model: %w", err)
	}
	mw, mwerr := summarization.New(ctx, &summarization.Config{
		Model:   cm,
		Trigger: &summarization.TriggerCondition{ContextTokens: contextTokenThreshold},
	})
	if mwerr != nil {
		return nil, fmt.Errorf("eino: summarization middleware: %w", mwerr)
	}
	agent, aerr := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "visitor",
		Description: "standmeet visitor chat agent",
		Instruction: in.Req.System,
		Model:       cm,
		ToolsConfig: adk.ToolsConfig{
			ToolsNodeConfig: compose.ToolsNodeConfig{Tools: in.Tools},
			ReturnDirectly:  in.ReturnDirectly,
		},
		MaxIterations: 8,
		Handlers:      []adk.ChatModelAgentMiddleware{mw},
	})
	if aerr != nil {
		return nil, fmt.Errorf("eino: new chat model agent: %w", aerr)
	}
	runner := adk.NewRunner(ctx, adk.RunnerConfig{Agent: agent, EnableStreaming: true})
	msgs, merr := turnInputMessages(in.Req)
	if merr != nil {
		return nil, merr
	}
	return runner.Run(ctx, msgs), nil
}

// turnInputMessages —— pi history + 当 turn user_message → ADK 喂入的
// []*schema.Message。复用 toEinoMessages (system 不带，instruction 那
// 边走)，再 append 当前 user_message。
func turnInputMessages(req *AgentTurnRequest) ([]*schema.Message, error) {
	msgs, err := toEinoMessages("", req.History)
	if err != nil {
		return nil, err
	}
	msgs = append(msgs, schema.UserMessage(req.UserMessage))
	return msgs, nil
}

// DriveAgentLoop —— HTTP-free：消费事件 iterator 灌进 sink，收尾跑 H.13
// follow-up suggestions + emit Done。caller (RunAgentTurn / eval-harness)
// 先 BuildAgentIterator 拿 iter，再调这个。
func DriveAgentLoop(
	ctx context.Context, log *slog.Logger,
	in *AgentTurnInput, iter *adk.AsyncIterator[*adk.AgentEvent], sink AgentSink,
) {
	em := &loopEmit{log: log, sink: sink, in: in, labels: in.ProgressLabels}
	state := consumeAgentEvents(ctx, em, iter)
	maybeEmitSuggestions(ctx, em, in, state)
	sink.Done(state.stop)
}

// turnState —— consumeAgentEvents 边走边累的转态。stop 是 ADK 给的
// FinishReason 翻译；assistantText 是本 turn assistant 流的全部文字
// (text delta + snapshot 累)，H.13 走它生成 follow-up suggestions。
type turnState struct {
	stop          string
	assistantText string
}

// consumeAgentEvents —— ADK iter → sink。每条 AgentEvent 看 Output
// (assistant text streaming / tool result) / Err，对应灌 sink。返当 turn
// 收尾的 state；Done 由 caller (DriveAgentLoop) 负责，让 caller 有机会在
// done 之前补 suggestions。
func consumeAgentEvents(
	ctx context.Context, em *loopEmit, iter *adk.AsyncIterator[*adk.AgentEvent],
) *turnState {
	state := &turnState{stop: "end_turn"}
	for {
		ev, hasNext := iter.Next()
		if !hasNext {
			return state
		}
		if !routeAgentEvent(ctx, em, ev, state) {
			return state
		}
	}
}

func routeAgentEvent(
	ctx context.Context, em *loopEmit, ev *adk.AgentEvent, state *turnState,
) bool {
	if ev.Err != nil {
		return handleTerminalError(ctx, em, state, ev.Err)
	}
	if ev.Output == nil || ev.Output.MessageOutput == nil {
		return true
	}
	return routeMessageVariant(ctx, em, ev.Output.MessageOutput, state)
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
	if state.assistantText != "" {
		if errors.Is(err, adk.ErrExceedMaxIterations) {
			em.log.Warn("agent turn max iterations after partial answer")
			return false
		}
		em.sink.Error(err)
		return false
	}
	em.log.Warn("agent turn terminal error with no answer; forcing final", logErrKey, err)
	if recovered := forceFinalAnswer(ctx, em); recovered != "" {
		em.sink.Text(recovered)
		state.assistantText = recovered
		return false
	}
	em.sink.Error(err)
	return false
}

// forceFinalAnswer —— 无 tool 一次性收口。复用当前 turn 的 system + history +
// user_message，附一句「搜索预算已用完，凭已知作答、缺具体就 in-voice 认怂、别再
// 搜」的提示。grounding 规则仍在 system 里，所以缺料时它会认怂而非编造。失败返空，
// 由 caller 退到固定话术。
func forceFinalAnswer(ctx context.Context, em *loopEmit) string {
	if em.in == nil || em.in.Req == nil {
		return ""
	}
	msgs := make([]ChatRequestMsg, 0, len(em.in.Req.History)+1)
	msgs = append(msgs, em.in.Req.History...)
	msgs = append(msgs, ChatRequestMsg{Role: "user", Content: em.in.Req.UserMessage})
	sys := em.in.Req.System + "\n\n(You've used your search budget for this turn. " +
		"Answer now from what you already know, without searching further. If you " +
		"don't have a specific example, say so briefly in your own voice and move on.)"
	out, err := Generate(ctx, em.in.Cred, &ChatRequest{System: sys, Messages: msgs})
	if err != nil {
		em.log.Warn("agent turn force-final generate", logErrKey, err)
		return ""
	}
	return out
}

// routeMessageVariant —— event 里携带的消息分三类：
//   - Role=Assistant + IsStreaming：模型生成的 text/tool_call 流，逐 chunk
//     灌 Text；流尾如 ToolCalls 非空灌 ToolStarted 一组
//   - Role=Assistant + 非 streaming：完整 final message，单条灌 + ToolCalls
//   - Role=Tool：tool 执行结果，灌 ToolCompleted
func routeMessageVariant(
	ctx context.Context, em *loopEmit, mv *adk.MessageVariant, state *turnState,
) bool {
	if mv.Role == schema.Tool {
		emitToolCompleted(em, mv)
		return true
	}
	if mv.Role != schema.Assistant {
		return true
	}
	if mv.IsStreaming {
		return drainAssistantStream(ctx, em, mv.MessageStream, state)
	}
	if mv.Message != nil {
		emitAssistantSnapshot(em, mv.Message, state)
	}
	return true
}

func drainAssistantStream(
	ctx context.Context, em *loopEmit,
	stream *schema.StreamReader[*schema.Message], state *turnState,
) bool {
	defer stream.Close()
	accum := newAssistantAccum()
	for {
		if ctx.Err() != nil {
			return false
		}
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			emitToolStarted(em, accum)
			return true
		}
		if err != nil {
			em.sink.Error(err)
			return false
		}
		processAssistantChunk(em, chunk, accum, state)
	}
}

func processAssistantChunk(
	em *loopEmit, chunk *schema.Message, accum *assistantAccum, state *turnState,
) {
	if chunk.Content != "" {
		em.sink.Text(chunk.Content)
		state.assistantText += chunk.Content
	}
	accumulateAssistantToolCalls(chunk.ToolCalls, accum)
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.FinishReason != "" {
		state.stop = mapFinishReason(chunk.ResponseMeta.FinishReason)
	}
}

func emitAssistantSnapshot(em *loopEmit, msg *schema.Message, state *turnState) {
	if msg.Content != "" {
		em.sink.Text(msg.Content)
		state.assistantText += msg.Content
	}
	if len(msg.ToolCalls) > 0 {
		accum := newAssistantAccum()
		accumulateAssistantToolCalls(msg.ToolCalls, accum)
		emitToolStarted(em, accum)
	}
	if msg.ResponseMeta != nil && msg.ResponseMeta.FinishReason != "" {
		state.stop = mapFinishReason(msg.ResponseMeta.FinishReason)
	}
}

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
		em.sink.ToolStarted(pc.ID, pc.Name, em.labels[pc.Name], json.RawMessage(args))
	}
}

// emitToolCompleted —— ADK 发 Role=Tool event 时调；content 是 tool
// 执行返回的字符串 (capability binding 一般是 JSON envelope，消费方
// 自己解)。
func emitToolCompleted(em *loopEmit, mv *adk.MessageVariant) {
	msg, err := mv.GetMessage()
	if err != nil {
		em.log.Error("agent turn tool result message", logErrKey, err)
		return
	}
	em.sink.ToolCompleted(mv.ToolName, msg.Content)
}
