// agent_turn.go —— POST /api/v1/agent/turn 的核心：用 eino ADK
// ChatModelAgent 跑一整轮 visitor agent loop (LLM ↔ tool 闭环)，把
// 事件流翻成 pi unified SSE 推给浏览器。
//
// H.9 之前 loop 在浏览器 pi-agent-core；H.9 起 loop 搬到 backend，浏览
// 器降为 event consumer (H.10)。Backend 持 ChatModelAgent + Runner +
// 拉 BindingTool 给 ToolsConfig，每轮把 ADK 抛的 AgentEvent 翻成：
//
//	event: text         data: {"delta":"..."}
//	event: tool_started data: {"name":"...","args":{},"progress_label":"..."}
//	event: tool_completed data: {"name":"...","result":<raw>,"ok":bool}
//	event: done         data: {"stop_reason":"end_turn|tool_use|max_tokens"}
//	event: error        data: {"code":"...","message":"..."}
//
// H.9.a 只覆盖 text + done 两种事件 + error。tool 事件 / capability state
// delta / throbber label / summarization middleware 是后续 slice (H.9.b /
// H.11 / H.9b) 增量。

package inference

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/cloudwego/eino/adk"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// AgentTurnRequest —— 浏览器 POST body。
//
// system + user_message 拼好直接当 ChatModelAgent 的 instruction +
// user input；history 是上一 turn 之前的对话记录（可能含 assistant
// tool_calls / tool 结果，用 pi unified shape），传给 ADK 当上下文。
type AgentTurnRequest struct {
	System      string           `json:"system"`
	UserMessage string           `json:"user_message"`
	Model       string           `json:"model,omitempty"`
	History     []ChatRequestMsg `json:"history,omitempty"`
}

// AgentTurnInput —— RunAgentTurn 的入参打包，避开 revive 5-arg 上限。
// 字段顺序按 govet fieldalignment 排：3 个 pointer 在前，slice 在后。
//
// ProgressLabels —— tool name → throbber 文案的查表，H.11 起 tool_started
// SSE 帧带 progress_label 字段下发给浏览器；前端直接读，不再走 zustand
// registry 本地查表。caller (route handler) 装好；inference 不知道
// 哪些 capability 注册了哪个 label，跨包 0 耦合。
type AgentTurnInput struct {
	Cred           *Cred
	Req            *AgentTurnRequest
	ProgressLabels map[string]string
	Tools          []tool.BaseTool
}

// sseSink —— SSE 输出三件套 (log + writer + flusher) 打包，避免每个
// helper 都接一长串参数；revive 5-arg 上限规避手段。labels 同时透到
// emitToolStarted 拿 throbber 文案。
type sseSink struct {
	log     *slog.Logger
	w       http.ResponseWriter
	flusher http.Flusher
	labels  map[string]string
}

// RunAgentTurn —— 跑一整轮 agent loop，向 sink.w 写 pi-style SSE。caller
// (route handler) 已经做完 auth + body 解 + cred resolve。
func RunAgentTurn(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter, in *AgentTurnInput,
) {
	iter, err := buildAgentIterator(ctx, in)
	if err != nil {
		writeProxyErr(log, w, err)
		return
	}
	setStreamSSEHeaders(w)
	consumeAgentEvents(ctx, &sseSink{
		log: log, w: w, flusher: pickFlusher(w), labels: in.ProgressLabels,
	}, iter)
}

func buildAgentIterator(
	ctx context.Context, in *AgentTurnInput,
) (*adk.AsyncIterator[*adk.AgentEvent], error) {
	cm, err := BuildChatModel(ctx, pickModelCred(in.Cred, in.Req.Model))
	if err != nil {
		return nil, fmt.Errorf("eino: build chat model: %w", err)
	}
	agent, aerr := adk.NewChatModelAgent(ctx, &adk.ChatModelAgentConfig{
		Name:        "visitor",
		Description: "standmeet visitor chat agent",
		Instruction: in.Req.System,
		Model:       cm,
		ToolsConfig: adk.ToolsConfig{
			ToolsNodeConfig: compose.ToolsNodeConfig{Tools: in.Tools},
		},
		MaxIterations: 8,
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

// consumeAgentEvents —— ADK iter → SSE 翻译。每条 AgentEvent 看 Output
// (assistant text streaming / tool result) / Err，对应 emit。流尾 emit
// done 帧。
func consumeAgentEvents(
	ctx context.Context, sink *sseSink, iter *adk.AsyncIterator[*adk.AgentEvent],
) {
	stop := "end_turn"
	for {
		ev, hasNext := iter.Next()
		if !hasNext {
			emitDone(sink.log, sink.w, sink.flusher, stop)
			return
		}
		if !routeAgentEvent(ctx, sink, ev, &stop) {
			return
		}
	}
}

func routeAgentEvent(
	ctx context.Context, sink *sseSink, ev *adk.AgentEvent, stop *string,
) bool {
	if ev.Err != nil {
		emitError(sink.log, sink.w, sink.flusher, ev.Err)
		return false
	}
	if ev.Output == nil || ev.Output.MessageOutput == nil {
		return true
	}
	return routeMessageVariant(ctx, sink, ev.Output.MessageOutput, stop)
}

// routeMessageVariant —— event 里携带的消息分三类：
//   - Role=Assistant + IsStreaming：模型生成的 text/tool_call 流，逐 chunk
//     emit text；流尾如 ToolCalls 非空 emit tool_started 一组
//   - Role=Assistant + 非 streaming：完整 final message，单条 emit + ToolCalls
//   - Role=Tool：tool 执行结果，emit tool_completed
func routeMessageVariant(
	ctx context.Context, sink *sseSink, mv *adk.MessageVariant, stop *string,
) bool {
	if mv.Role == schema.Tool {
		emitToolCompleted(sink, mv)
		return true
	}
	if mv.Role != schema.Assistant {
		return true
	}
	if mv.IsStreaming {
		return drainAssistantStream(ctx, sink, mv.MessageStream, stop)
	}
	if mv.Message != nil {
		emitAssistantSnapshot(sink, mv.Message, stop)
	}
	return true
}

func drainAssistantStream(
	ctx context.Context, sink *sseSink,
	stream *schema.StreamReader[*schema.Message], stop *string,
) bool {
	defer stream.Close()
	accum := newAssistantAccum()
	for {
		if ctx.Err() != nil {
			return false
		}
		chunk, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			emitToolStarted(sink, accum)
			return true
		}
		if err != nil {
			emitError(sink.log, sink.w, sink.flusher, err)
			return false
		}
		processAssistantChunk(sink, chunk, accum, stop)
	}
}

func processAssistantChunk(
	sink *sseSink, chunk *schema.Message, accum *assistantAccum, stop *string,
) {
	if chunk.Content != "" {
		emitTextDelta(sink.log, sink.w, sink.flusher, chunk.Content)
	}
	accumulateAssistantToolCalls(chunk.ToolCalls, accum)
	if chunk.ResponseMeta != nil && chunk.ResponseMeta.FinishReason != "" {
		*stop = mapFinishReason(chunk.ResponseMeta.FinishReason)
	}
}

func emitAssistantSnapshot(sink *sseSink, msg *schema.Message, stop *string) {
	if msg.Content != "" {
		emitTextDelta(sink.log, sink.w, sink.flusher, msg.Content)
	}
	if len(msg.ToolCalls) > 0 {
		accum := newAssistantAccum()
		accumulateAssistantToolCalls(msg.ToolCalls, accum)
		emitToolStarted(sink, accum)
	}
	if msg.ResponseMeta != nil && msg.ResponseMeta.FinishReason != "" {
		*stop = mapFinishReason(msg.ResponseMeta.FinishReason)
	}
}

// assistantAccum —— streaming 期间累积 assistant message 里的 tool_calls。
// eino chunk 增量返 ToolCall.Function.Arguments，按 Index 聚合，流尾一次
// emit 完整 tool_started。
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

// emitToolStarted —— 流尾把累积的 tool_call 全部 emit。progress_label 走
// sink.labels 查表 (H.11)，浏览器 throbber 直接读这条；缺则前端 fallback
// "running <name>"。
func emitToolStarted(sink *sseSink, accum *assistantAccum) {
	for _, pc := range accum.calls {
		args := pc.Args
		if args == "" {
			args = "{}"
		}
		body, merr := json.Marshal(toolStartedPayload{
			ID: pc.ID, Name: pc.Name, Args: json.RawMessage(args),
			ProgressLabel: sink.labels[pc.Name],
		})
		if merr != nil {
			sink.log.Error("agent turn marshal tool_started", logErrKey, merr)
			continue
		}
		writeSSEFrame(sink.log, sink.w, sink.flusher, "tool_started", body)
	}
}

// emitToolCompleted —— ADK 发 Role=Tool event 时调；content 是 tool
// 执行返回的字符串 (capability binding 一般是 JSON envelope，浏览器
// 自己解)。
func emitToolCompleted(sink *sseSink, mv *adk.MessageVariant) {
	msg, err := mv.GetMessage()
	if err != nil {
		sink.log.Error("agent turn tool result message", logErrKey, err)
		return
	}
	body, merr := json.Marshal(toolCompletedPayload{
		Name: mv.ToolName, Result: msg.Content,
	})
	if merr != nil {
		sink.log.Error("agent turn marshal tool_completed", logErrKey, merr)
		return
	}
	writeSSEFrame(sink.log, sink.w, sink.flusher, "tool_completed", body)
}

type toolStartedPayload struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	ProgressLabel string          `json:"progress_label,omitempty"`
	Args          json.RawMessage `json:"args"`
}

type toolCompletedPayload struct {
	Name   string `json:"name"`
	Result string `json:"result"`
}
