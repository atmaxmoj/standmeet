// agent_turn.go —— POST /api/v1/agent/turn 的 HTTP 出口：把 transport-
// agnostic 的 agentic core (agent_loop.go) 接到浏览器 pi SSE 上。
//
//	RunAgentTurn = BuildAgentIterator (pre-stream) + sseSink + DriveAgentLoop
//
// agent loop 本体 (build model + ADK ChatModelAgent + 消费事件) 全在
// agent_loop.go，对 AgentSink 接口编程；本文件只提供 sseSink —— 把每条
// 事件写成 pi unified SSE 帧 (text / tool_started / tool_completed /
// suggestions / done / error)。eval-harness 复用 agent_loop.go 同一条
// loop，注入自己的 transcript sink。

package inference

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/cloudwego/eino/components/tool"
)

// AgentTurnRequest —— 浏览器 POST body。
//
// system + user_message 拼好直接当 ChatModelAgent 的 instruction +
// user input；history 是上一 turn 之前的对话记录（可能含 assistant
// tool_calls / tool 结果，用 pi unified shape），传给 ADK 当上下文。
//
// ConversationID —— 持久化的 chat ID (issueSession 时返回的)；backend
// 内部 tool (calendar_book / dialog persist) 用来把当 turn 的产物关
// 联到正确的 conversation 行。老 /sessions/{convID}/tools/{name} wire
// 走 URL path；新 /agent/turn 由 body 透。
type AgentTurnRequest struct {
	System         string           `json:"system"`
	UserMessage    string           `json:"user_message"`
	ConversationID string           `json:"conversation_id"`
	Model          string           `json:"model,omitempty"`
	History        []ChatRequestMsg `json:"history,omitempty"`
}

// AgentTurnInput —— RunAgentTurn / BuildAgentIterator 的入参打包，避开
// revive 5-arg 上限。字段顺序按 govet fieldalignment 排：3 个 pointer 在
// 前，slice 在后。
//
// ProgressLabels —— tool name → throbber 文案的查表，H.11 起 tool_started
// SSE 帧带 progress_label 字段下发给浏览器；前端直接读，不再走 zustand
// registry 本地查表。caller (route handler) 装好；inference 不知道
// 哪些 capability 注册了哪个 label，跨包 0 耦合。
//
// Mode —— visitor session mode (public / code / byoai)。H.13 起 code-accessor
// session 在 turn 收尾前 emit `suggestions` SSE event (follow-up 问题
// chip)；public / byoai 不出 chip。
type AgentTurnInput struct {
	Cred           *Cred
	Req            *AgentTurnRequest
	ProgressLabels map[string]string
	// ReturnDirectly —— I.1: tool name → true 表示调完直接结束 agent
	// loop，不再多转一轮 LLM (ask_visitor 这种 echo-only tool 用)。
	// nil / 空 map = 全部 tool 走默认 react 循环。
	ReturnDirectly map[string]bool
	Mode           string
	Tools          []tool.BaseTool
}

// RunAgentTurn —— 跑一整轮 agent loop，向 w 写 pi-style SSE。caller (route
// handler) 已经做完 auth + body 解 + cred resolve。pre-stream 失败 (model
// build / msg 解析) 走 writeProxyErr (HTTP status + 一帧 error)；进流之后
// 全经 sseSink 出 SSE 帧。
func RunAgentTurn(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter, in *AgentTurnInput,
) {
	iter, err := BuildAgentIterator(ctx, in)
	if err != nil {
		writeProxyErr(log, w, err)
		return
	}
	setStreamSSEHeaders(w)
	sink := &sseSink{log: log, w: w, flusher: pickFlusher(w)}
	DriveAgentLoop(ctx, log, in, iter, sink)
}

// sseSink —— AgentSink 的 prod 实现：每条 agent loop 事件写成一帧 pi
// unified SSE 推给浏览器。
type sseSink struct {
	log     *slog.Logger
	w       http.ResponseWriter
	flusher http.Flusher
}

var _ AgentSink = (*sseSink)(nil)

func (s *sseSink) Text(delta string) {
	emitTextDelta(s.log, s.w, s.flusher, delta)
}

func (s *sseSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	body, err := json.Marshal(toolStartedPayload{
		ID: id, Name: name, Args: args, ProgressLabel: progressLabel,
	})
	if err != nil {
		s.log.Error("agent turn marshal tool_started", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "tool_started", body)
}

func (s *sseSink) ToolCompleted(name, result string) {
	body, err := json.Marshal(toolCompletedPayload{Name: name, Result: result})
	if err != nil {
		s.log.Error("agent turn marshal tool_completed", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "tool_completed", body)
}

func (s *sseSink) Suggestions(items []string) {
	body, err := json.Marshal(suggestionsPayload{Items: items})
	if err != nil {
		s.log.Error("agent turn marshal suggestions", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "suggestions", body)
}

func (s *sseSink) Error(err error) {
	emitError(s.log, s.w, s.flusher, err)
}

func (s *sseSink) Done(stop string) {
	emitDone(s.log, s.w, s.flusher, stop)
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

// suggestionsPayload —— SSE `suggestions` 帧负载。items 是 3 条 follow-up
// question 字符串数组 (H.13)；解析失败 / 非 code-accessor session 时
// items=[] 当 "no chip"。生成逻辑在 agent_turn_suggestions.go。
type suggestionsPayload struct {
	Items []string `json:"items"`
}
