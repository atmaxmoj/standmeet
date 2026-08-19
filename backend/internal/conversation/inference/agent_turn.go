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
// 给一个上限,超了取消 in-flight LLM call → 边界收口(handleTerminalError)。
// AGENT_TURN_TIMEOUT(秒)可覆盖(e2e 设短复现)。
//
// Sized WITH the iteration budget: maxAgentIterations(24) legitimizes deep crawls of
// several minutes on a real vault; a 120s cap made every such crawl die at the TIME wall
// instead (observed live: broad question → 26 retrievals → "That took too long", evidence
// discarded). The two budgets must agree on what a legitimate turn is.
const defaultAgentTurnTimeout = 300 * time.Second

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
	DocContext      *AgentDocContext `json:"doc_context,omitempty"`
	System          string           `json:"system"`
	UserMessage     string           `json:"user_message"`
	ConversationID  string           `json:"conversation_id"`
	Model           string           `json:"model,omitempty"`
	VisitorTimezone string           `json:"visitor_timezone,omitempty"`
	History         []ChatRequestMsg `json:"history,omitempty"`
}

// AgentDocContext —— 访客当前所在 document 的最小标识(给指代解析用)。
type AgentDocContext struct {
	Title string `json:"title"`
	Path  string `json:"path"`
	Genre string `json:"genre"` // wiki | output | writing
}

// 通用 instruction 的组合器(doc / date+tz / cross-conv)拆到 agent_instruction.go
// 守 350-line cap。

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
	// RecordUsage —— #106 计费:turn 收尾把本轮累计 token 用量交出去。route handler 注入走
	// inference_usage 表的闭包(闭进 owner_id;BYOAI 传 no-op —— 访客自付不计 owner)。
	// nil = 不计(无状态 smoke / 无 owner)。inference 不碰 DB。
	RecordUsage RecordUsageFunc
	// MarkWaypoints —— ghost-steering ledger port。turn 收尾把本轮引用 + booking 命中交出去,
	// route handler 注入的闭包标 waypoint visited + 存 session。nil = 不标(非 code / 无 waypoints)。
	MarkWaypoints MarkWaypointsFunc
	// BuildGhost —— ghost-steering policy port。done 之后据本轮末条回复出至多一个 steering ghost
	// (route 闭包:GhostPolicy LLM + 落 conversation_ghosts)。nil = 不出(非 code / 无 waypoints)。
	Epilogue EpilogueFunc
	// TurnEnded —— 「这一轮对访客已经结束」的回调,在 `done` 帧发出去的同一刻调用(落库之后)。
	//
	// route handler 拿它**放掉这一场的并发槽**。以前槽是 `defer release()`,要等 handler 返回 ——
	// 而 handler 在 done 之后还要跑 epilogue(一次真的 ghost LLM 调用,prod 上实测 10-26 秒)。
	// 于是访客收到「说完了」的回执之后,这一场在服务端仍然是 busy 的,下一问会被
	// `query_queue.go` 的每会话单飞闸**立即拒掉**(不排队)——F-A-42 的服务端那一半。
	//
	// 语义边界:done = 已提交(落库在这之前),所以这一刻放槽不会让下一轮读到半截历史。
	// nil = 不放(无队列的调用点)。调用必须幂等 —— route 那侧仍有 defer 兜底。
	TurnEnded func()
	Mode      string
	// CrossConvContext —— 「互通」:该 member 其他对话的 digest。instructionWithCrossConv
	// 把它拼进 instruction 让 AI 跨对话连贯;route handler 装(读 DB),inference 不碰
	// DB。空 = 不注入(public / 无 member / 没别的对话)。
	CrossConvContext string
	// OwnerTimezone —— owner 的 IANA tz (owners.profile_timezone)。
	// instructionWithDateTime 用它把"现在几点 + 在哪个时区"锚进通用 instruction。
	// 空 → 退 UTC。route handler 装 (读 owner);inference 不碰 DB。
	OwnerTimezone string
	// VisitorTimezone —— 访客浏览器 tz(从 AgentTurnRequest 透传)。instructionWithDateTime
	// 用它告诉 agent 访客在哪个时区,解释访客给的时间(尤其 booking)不再含糊(#120)。
	VisitorTimezone string
	Tools           []tool.BaseTool
	// ClaimGates —— 本场授了的能力声明的「说了就得做」条件(装配期从 manifest 带进来)。
	// 空 = 这一轮没有需要回执支撑的主张。见 agent_claim_gate.go。
	ClaimGates []ClaimGate
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
	acc.onDone = func() {
		persistTurn(ctx, log, in, acc)
		markWaypointsTurn(ctx, in, acc)
		// 落库之后、`done` 帧写出去之前放槽：访客收到回执的那一刻，这一场在服务端就
		// 不再 busy 了。之后的 epilogue 是后台账，不该让下一问撞墙（F-A-42）。
		if in.TurnEnded != nil {
			in.TurnEnded()
		}
	}
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
// 边界那次救场跑在**时间墙之后**（脱离的 ctx + 自己的预算），所以这条写超时必须把它也算进去。
// 少算的代价在 prod 上量到过（F-A-44）：turn 撞墙 300s → 救场再花 60s → `done` 帧在 360s
// 写出去，而写超时是 315s —— 连接早被服务端自己掐了，浏览器**从没收到那一帧**。
// 于是后端判得对（`stop=deadline`），访客读到的还是 SDK 那句「没见到 done 帧」的兜底
// 「连接断了，再问一次」。判得对而送不到，跟判错没有区别。
func extendStreamWriteDeadline(log *slog.Logger, w http.ResponseWriter, timeout time.Duration) {
	rc := http.NewResponseController(w)
	budget := timeout + forceFinalTimeout() + writeDeadlineGrace
	if err := rc.SetWriteDeadline(time.Now().Add(budget)); err != nil {
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

// shownResult —— 这一次工具调用的结果能不能原样发到线上。
//
// **现在原样发,而这是 F-A-28 还没关掉的那一半。** 检索结果里是笔记正文(含私有 subjectivity),
// 落库那条路已经剥掉了(history.go 走 VisitorToolCalls),直播这条路还没有。
//
// 不能就地剥:**访客的引用脚注是前端从这些结果里自己算出来的**。剥掉 result,footer 整个消失
// (visitor-chat-tool-cards 立刻红)。也就是说设计所依赖的 show_as_source 闸,实际上是浏览器里
// 对一份已经含私有正文的 payload 做的过滤 —— 服务端把全部东西发出去,由客户端决定显示哪些。
//
// 要关掉这一半,得先让服务端把 citations 作为一帧发出来(它已经在算了,history 的回参里就有),
// 让 footer 不再依赖原始结果。那是流协议的改动,不是这里加一个 if。
func shownResult(_, result string) string {
	return result
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

// ToolCompleted —— 把一次工具调用的结果发到线上。
//
// 结果先过 shownResult:哪些工具的结果能给对面看,是**产品规则**,由 caller 注入
// (AgentTurnInput.ShowToolResult)。内核不认识任何一个具体工具名。
// 累计 citation 走的是 accumSink,拿的是同一份原始结果,不受这里影响。
func (s *sseSink) ToolCompleted(name, result string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body, err := json.Marshal(toolCompletedPayload{
		Name: name, Result: shownResult(name, result),
	})
	if err != nil {
		s.log.Error("agent turn marshal tool_completed", logErrKey, err)
		return
	}
	writeSSEFrame(s.log, s.w, s.flusher, "tool_completed", body)
}

// Epilogue —— emit a single post-`done` frame as an SSE event named by f.Kind (e.g. "ghost"), with
// f.Payload as the data. The kernel doesn't name the frame kind or shape — the caller (route) does.
func (s *sseSink) Epilogue(f *EpilogueFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeSSEFrame(s.log, s.w, s.flusher, f.Kind, f.Payload)
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

// retryingPayload —— SSE `retrying` 帧负载。attempt 是第几次重试(从 1 起)。
type retryingPayload struct {
	Attempt int `json:"attempt"`
}
