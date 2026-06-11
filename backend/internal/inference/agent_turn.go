// agent_turn.go —— POST /api/v1/agent/turn 的 HTTP 出口：把 transport-
// agnostic 的 agentic core (agent_loop.go) 接到浏览器 pi SSE 上。
//
//	RunAgentTurn = BuildAgentIterator (pre-stream) + sseSink + DriveAgentLoop
//
// agent loop 本体 (build model + ADK ChatModelAgent + 消费事件) 全在
// agent_loop.go，对 AgentSink 接口编程；本文件只提供 sseSink —— 把每条
// 事件写成 pi unified SSE 帧 (text / tool_started / tool_completed /
// ghosts / done / error)。eval-harness 复用 agent_loop.go 同一条
// loop，注入自己的 transcript sink。

package inference

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/cloudwego/eino/components/tool"
)

// defaultAgentTurnTimeout —— 一整轮 agent loop(含所有 tool 迭代 + 末尾
// ghosts)的硬上限。第三方 LLM 偶尔在大上下文上巨慢/卡住,SSE handler 的
// ctx 只要浏览器不断连就一直活着 → 不设 deadline 就无限等(前端永远 retrieving)。
// 给一个上限,超了取消 in-flight LLM call → surface 一帧 error 让前端解卡。
// AGENT_TURN_TIMEOUT(秒)可覆盖(e2e 设短复现)。
const defaultAgentTurnTimeout = 120 * time.Second

func agentTurnTimeout() time.Duration {
	if s := os.Getenv("AGENT_TURN_TIMEOUT"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return defaultAgentTurnTimeout
}

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
	System         string `json:"system"`
	UserMessage    string `json:"user_message"`
	ConversationID string `json:"conversation_id"`
	Model          string `json:"model,omitempty"`
	// DocContext —— 访客发问时正看着哪篇 doc(reader/wiki/output 页或浮窗所在页)。
	// 低信任的导航上下文,backend 用固定模板注进 instruction,让「this/这篇/这个项目」
	// 这类指代能解析(#36)。nil = 不在 doc 页(如主 chat 全屏)。
	DocContext *AgentDocContext `json:"doc_context,omitempty"`
	History    []ChatRequestMsg `json:"history,omitempty"`
}

// AgentDocContext —— 访客当前所在 document 的最小标识(给指代解析用)。
type AgentDocContext struct {
	Title string `json:"title"`
	Path  string `json:"path"`
	Genre string `json:"genre"` // wiki | output | writing
}

// instructionWithDoc —— persona instruction 末尾拼一段「访客正看着 X」的位置上下文,
// 让代词指代("this page"/"这篇"/"这个项目")解析到那篇 doc。doc 为 nil / 空 → 原样返。
func instructionWithDoc(system string, doc *AgentDocContext) string {
	if doc == nil || doc.Title == "" {
		return system
	}
	loc := "\n\nContext: the visitor is currently reading the page \"" + doc.Title + "\""
	if doc.Path != "" {
		loc += " (/" + doc.Genre + "/" + doc.Path + ")"
	}
	loc += " on this site. When they say \"this\", \"this page\", \"this doc\", " +
		"\"this project\", or similar without naming it, they mean that document — " +
		"pull it up with your corpus tools if it helps answer."
	return system + loc
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
// session 在 turn 收尾前 emit `ghosts` SSE event (follow-up 问题
// chip)；public / byoai 不出 chip。
type AgentTurnInput struct {
	Cred           *Cred
	Req            *AgentTurnRequest
	ProgressLabels map[string]string
	// ReturnDirectly —— I.1: tool name → true 表示调完直接结束 agent
	// loop，不再多转一轮 LLM (ask_visitor 这种 echo-only tool 用)。
	// nil / 空 map = 全部 tool 走默认 react 循环。
	ReturnDirectly map[string]bool
	// Persist —— #28: 落库 port。loop 收尾(AI 答出内容时)把累计的 TurnResult
	// sink 进 conversation 表。nil = 不落(无 conversation 的无状态 smoke 调用)。
	// caller (route handler) 注入走 RecordDialog 的闭包;inference 不碰 DB。
	Persist PersistFunc
	Mode    string
	Tools   []tool.BaseTool
}

// RunAgentTurn —— 跑一整轮 agent loop，向 w 写 pi-style SSE。caller (route
// handler) 已经做完 auth + body 解 + cred resolve。pre-stream 失败 (model
// build / msg 解析) 走 writeProxyErr (HTTP status + 一帧 error)；进流之后
// 全经 sseSink 出 SSE 帧。
func RunAgentTurn(
	ctx context.Context, log *slog.Logger, w http.ResponseWriter, in *AgentTurnInput,
) {
	timeout := agentTurnTimeout()
	// #28: detached ctx —— loop 跑在脱离请求的 context 上,客户端断开(刷新/关页)
	// 不再取消它。流照样流完、流末端照样 sink 进 DB。timeout 仍兜上限(超了取消
	// in-flight LLM call)。显示 sink 写浏览器失败无所谓(连接没了),只记日志不中断。
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	ctx = withLLMLog(ctx, log) // so the retry transport (http_retry.go) can log
	start := time.Now()
	log.Info("agent turn start", "model", credModel(in.Cred), "mode", in.Mode,
		"tools", len(in.Tools), "timeout_s", int(timeout.Seconds()))

	sink := &sseSink{log: log, w: w, flusher: pickFlusher(w)}
	// 重试通知顺 ctx 带给 transport(http_retry.go):它每次退避前调 sink.Retrying
	// → emit `retrying` 帧。装在 BuildAgentIterator 之前,让 model call 用的
	// ctx 就带着回调。
	ctx = withRetryNotifier(ctx, sink.Retrying)

	iter, err := BuildAgentIterator(ctx, in)
	if err != nil {
		log.Error("agent turn build failed", logErrKey, err,
			"dur_ms", time.Since(start).Milliseconds())
		writeProxyErr(log, w, err)
		return
	}
	setStreamSSEHeaders(w)
	extendStreamWriteDeadline(log, w, timeout)
	// accumSink tee 显示 sink + 流末端累计;收尾(Done 前)把这一轮 sink 进 DB
	// (detached ctx,客户端断开也落)。落在 Done 之前 → `done` 帧代表已提交。
	acc := newAccumSink(sink)
	acc.onDone = func() { persistTurn(ctx, log, in, acc) }
	DriveAgentLoop(ctx, log, in, iter, acc)

	dur := time.Since(start)
	logAgentTurnEnd(ctx, log, dur, timeout)
}

// writeDeadlineGrace —— write deadline 比 agent turn ctx timeout 多留这点,
// 让 ctx 超时那一刻 sink 还来得及把 error/done 帧刷出去再被 server 掐。
const writeDeadlineGrace = 15 * time.Second

// extendStreamWriteDeadline —— 解"长 turn 被 http.Server.WriteTimeout(30s)
// 拦腰掐断"的根因。WriteTimeout 是对**整条响应**写完的硬上限,对常规 endpoint
// 合理,但 SSE 流式响应会一直写到 turn 结束;>30s 的 turn(大 JD + 慢 LLM +
// 多轮 tool)会在中途被 server 关连接 → 浏览器收 ERR_INCOMPLETE_CHUNKED_ENCODING、
// 前端永远 retrieving。这里用 ResponseController 把**本条连接**的 write deadline
// 推到 agent turn timeout 之外,真正的上限交给上面的 ctx WithTimeout 兜。
// httptest.Recorder 等不支持 deadline 的 writer 会返 ErrNotSupported —— 记一行
// 即可,流仍由 ctx 控住。
func extendStreamWriteDeadline(log *slog.Logger, w http.ResponseWriter, timeout time.Duration) {
	rc := http.NewResponseController(w)
	if err := rc.SetWriteDeadline(time.Now().Add(timeout + writeDeadlineGrace)); err != nil {
		log.Warn("agent turn: extend write deadline unsupported (stream capped by ctx only)",
			logErrKey, err)
	}
}

// logAgentTurnEnd —— 收尾日志:正常完成打 info;命中 deadline 打 warn(尤其是
// 让"卡死"在日志里可见 —— 之前对超时 LLM call 啥都不打)。
func logAgentTurnEnd(ctx context.Context, log *slog.Logger, dur, timeout time.Duration) {
	if ctx.Err() == context.DeadlineExceeded {
		log.Warn("agent turn TIMED OUT — upstream LLM too slow / stalled",
			"dur_ms", dur.Milliseconds(), "timeout_s", int(timeout.Seconds()))
		return
	}
	log.Info("agent turn done", "dur_ms", dur.Milliseconds())
}

// credModel —— nil-safe model 名,给日志用。
func credModel(c *Cred) string {
	if c == nil {
		return ""
	}
	return c.Model
}

// sseSink —— AgentSink 的 prod 实现：每条 agent loop 事件写成一帧 pi
// unified SSE 推给浏览器。
//
// mu —— Retrying 由 transport 在 eino 的 model-call goroutine 里触发,可能
// 跟主 DriveAgentLoop goroutine 写 Text/ToolStarted 撞;每个方法整帧写在锁
// 内,保证 SSE 帧不交错(帧粒度原子)。
type sseSink struct {
	log     *slog.Logger
	w       http.ResponseWriter
	flusher http.Flusher
	mu      sync.Mutex
}

var _ AgentSink = (*sseSink)(nil)

func (s *sseSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	emitTextDelta(s.log, s.w, s.flusher, delta)
}

func (s *sseSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(toolCompletedPayload{Name: name, Result: result})
	if err != nil {
		s.log.Error("agent turn marshal tool_completed", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "tool_completed", body)
}

func (s *sseSink) Ghosts(items []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(ghostsPayload{Items: items})
	if err != nil {
		s.log.Error("agent turn marshal ghosts", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "ghosts", body)
}

func (s *sseSink) Retrying(attempt int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(retryingPayload{Attempt: attempt})
	if err != nil {
		s.log.Error("agent turn marshal retrying", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "retrying", body)
}

func (s *sseSink) Error(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	emitError(s.log, s.w, s.flusher, err)
}

func (s *sseSink) Done(stop string) {
	s.mu.Lock()
	defer s.mu.Unlock()
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

// ghostsPayload —— SSE `ghosts` 帧负载。items 是 3 条 follow-up
// question 字符串数组 (H.13)；解析失败 / 非 code-accessor session 时
// items=[] 当 "no chip"。生成逻辑在 agent_turn_ghosts.go。
type ghostsPayload struct {
	Items []string `json:"items"`
}

// retryingPayload —— SSE `retrying` 帧负载。attempt 是第几次重试(从 1 起)。
type retryingPayload struct {
	Attempt int `json:"attempt"`
}
