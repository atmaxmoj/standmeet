// chat.go —— /api/v1/* 路由挂载 + visitor 错误码表 + auth/bearer helper。
// Chat 数据流（#28 之后）：
//   - POST /sessions                颁发 visitor session
//   - POST /agent/turn              eino ADK driven 整 turn;**自己**在流末端
//                                   把这段 Dialog sink 进 conversation 表(配额
//                                   也在入口查)。backend 拥有这一轮,前端只显示。
//   - POST /sessions/{id}/tools/..  单 tool 执行
//   - GET  /report/{id}             读一份 chat report (I.3)
//
// 老 POST /sessions/{id}/dialogs(前端自落库)#28 退役 —— 落库整个挪到
// /agent/turn 流末端,单一 sink、无双写。老 POST /summary I.3 删,改走
// summarize_conversation capability。

package public

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// Handlers —— public routes deps.
type Handlers struct {
	Visitor  conversation.VisitorSessionDeps
	Outbound owner.OutboundSender // 送得出去吗 —— /sessions 回参里那个开关
	// Owners —— persona 第一句「你是谁」的名字来源(UX-66)。它跟语料范围无关，
	// 所以取自 owner 那一行，不指望检索碰巧捞到一条自我介绍。
	Owners       owner.OpsHostLookup
	Usage        UsageRecorder
	Reports      conversation.ReportStore
	Corpus       conversation.DialogCorpusLookup
	Subjectivity corpus.SubjectivityCiteLookup
	PDFRenderer  ReportPDFRenderer
	AppState     AppStateStore
	Resolver     inference.Resolver
	CodeGuard    CodeGuard
	Sessions     *access.VisitorSessionStore
	QueryQueue   *session.QueryQueue
	Ledger       *conversation.WaypointLedger
	Ghosts       conversation.GhostDeps
	Log          *slog.Logger
	SecureCookie bool
}

// CodeGuard —— 访问码兑换失败锁定端口(#169)。impl = middleware.CodeGuard,注入进来。
type CodeGuard interface {
	Locked(ctx context.Context, ip, captchaToken string) bool
	// HasLift —— 被锁住的人此刻有没有一条自己走得通的出路（captcha 开着才有）。
	// 拒绝那句话按它选词，否则它会去描述一个屏幕上不存在的控件。
	HasLift() bool
	RecordFail(ctx context.Context, ip string)
	Reset(ctx context.Context, ip string)
}

// UsageRecorder —— #106 计费 port:记一次 owner-key LLM 用量。BYOAI 不经此(访客自付)。
// 入参是一整行(含 provider + 算不算油钱),不是几个参数 —— 那正是分辨率丢在签名上的地方。
type UsageRecorder interface {
	Record(ctx context.Context, row *stats.UsageRow) error
}

// Mount 挂 /api/v1/* 路由。caller 负责前缀。需要访客 session 的路由统一套
// withVisitorSession 装饰器(校验 + 把 authedVisitor 塞 ctx);不需要的(发 session /
// peek code / 列模型)裸挂。
func (h *Handlers) Mount(r chi.Router) {
	// ── 无需 session ──
	r.Post("/sessions", h.createSession())
	// codes/intro —— 名字选择器 pre-issue 的公开 peek(code 走 body 不入 URL log)。
	r.Post("/codes/intro", h.codeIntro())
	r.Post("/inference/models", h.listInferenceModels())

	// ── 需要访客 session(装饰器统一校验) ──
	// F-L-11 liveness probe:读者/聊天 mount 时探一下 stored token 还活着没(TTL 过期 → 401),
	// 让前端丢掉过期 session 的假「unlocked」chrome,而不是无限信任 localStorage。
	r.Get("/session", h.withVisitorSession(h.getSessionInfo()))
	// 刷新恢复:返回整个会话聚合(session + code + conversation),前端一次性
	// hydrate。范围由 token 锁定(member → open chat),URL {id} 仅做 RESTful 形态。
	r.Get("/conversations/{id}", h.withVisitorSession(h.getConversation()))
	// 多对话模型:浮窗在某篇 doc 上 find-or-create 自己那段对话(跟主聊天独立,
	// 共享 member 级配额)。body {doc_key} → {conversation_id, conversation}。
	r.Post("/conversations", h.withVisitorSession(h.openDocConversation()))
	// 同一 dispatch handler 挂 POST + QUERY。QUERY（RFC 10008）是只读工具（corpus_search/
	// read/list/links）的语义正确入口（安全/幂等 + 带 body）；会改状态的工具走 QUERY → 405
	// （gate 在 tools.go）。POST 对全工具照旧（向后兼容）。
	toolDisp := h.withVisitorSession(h.toolDispatch())
	r.Post("/sessions/{id}/tools/{tool_name}", toolDisp)
	r.Method(methodQuery, "/sessions/{id}/tools/{tool_name}", toolDisp)
	// MCP App 跨刷新状态：沙箱卡经 host 对自己 mcp 那格增删改查。mcp_id 由 {tool} 派生。
	r.Get("/sessions/{id}/app-state/{tool}", h.withVisitorSession(h.getAppState()))
	r.Put("/sessions/{id}/app-state/{tool}/{key}", h.withVisitorSession(h.setAppState()))
	r.Delete("/sessions/{id}/app-state/{tool}/{key}", h.withVisitorSession(h.deleteAppState()))
	// #122/#123: 约成后访客点卡上的按钮(发确认信 / 取消)→ 直接经 mcp-ui:tool 派给沙箱 booker
	// 自己的工具(send_confirmation / calendar_cancel),host 不再有对应的 REST 路由。
	// 两条老路由都已退役 —— 取消那条曾经在 host 留了两份实现(owner 侧 + 访客侧),
	// 跟沙箱里那份是同一件事的三种写法。
	// #123: 访客取消自己约的会议。隔离在 usecase(owner+code+member 解析 event_id),
	// 不属于本 member → 404。AI 不参与。
	// I.3: /report/{id} 拿一份 chat_reports 行 (visitor 浏览器
	// /report/[id] 独立路由 fetch；owner 端走 admin route 后续单独加)。
	r.Get("/report/{id}", h.withVisitorSession(h.getReport()))
	r.Get("/report/{id}/pdf", h.withVisitorSession(h.getReportPDF()))
	r.Post("/llm/chat/stream", h.withVisitorSession(h.llmChatStream()))
	// H.9: 新 agent turn 入口；走 eino ADK ChatModelAgent。SDK 在 H.10
	// 切到这条；H.10 land 后 /llm/chat/stream 退役。
	r.Post("/agent/turn", h.withVisitorSession(h.agentTurn()))
	// H.13.e: ghost text 日志写路径。shown 在浏览器渲 ghost 时一次性
	// 写一行；accept 在 visitor 按 Tab 时调；owner admin 详情页读这些。
	r.Post("/sessions/{id}/ghosts/shown", h.withVisitorSession(h.postGhostShown()))
	r.Post("/sessions/{id}/ghosts/{sid}/accept", h.withVisitorSession(h.postGhostAccept()))
}

var visitorErrCases = []apierr.Case{
	{Match: apierr.ErrEmptyField, Envelope: apierr.Envelope{
		Status: http.StatusBadRequest, Code: "bad_request", Message: "missing required field",
	}},
	{Match: access.ErrCodeInvalid, Envelope: apierr.Envelope{
		Status: http.StatusUnauthorized,
		Code:   "code_invalid",
		// 「不存在」和「被撤销」曾经共用一句 "invalid or revoked" —— 而这两种人的下一步
		// 相反:打错字重新粘一次,被撤销去要一张新的。合成一句,谁都不知道该做什么(F-D-6)。
		Message: "no such access code — check it and paste it again",
	}},
	{Match: access.ErrCodeRevoked, Envelope: apierr.Envelope{
		Status: http.StatusUnauthorized,
		Code:   "code_revoked",
		// 指下一步,而不是复述状态:这张码不会再好用了,再试多少次都一样。
		Message: "this access code was revoked — ask the owner for a new one",
	}},
	{Match: access.ErrCodeExpired, Envelope: apierr.Envelope{
		Status: http.StatusUnauthorized, Code: "code_expired", Message: "access code expired",
	}},
	{Match: access.ErrMemberQuotaReached, Envelope: apierr.Envelope{
		Status:  http.StatusForbidden,
		Code:    "member_quota_reached",
		Message: "this code is full — no more names available",
	}},
	{Match: access.ErrTurnQuotaReached, Envelope: apierr.Envelope{
		Status:  http.StatusForbidden,
		Code:    "turn_quota_reached",
		Message: "this session has reached its turn limit",
	}},
	{Match: access.ErrGasExhausted, Envelope: apierr.Envelope{
		Status: http.StatusForbidden,
		Code:   "gas_exhausted",
		// 访客读到的那句。不说 token、不说油箱、不说是谁的钱 —— 他做不了任何事;
		// 也不许诺"已通知 owner",那是一句没人去实现的承诺。
		Message: "this conversation has reached its usage limit",
	}},
	{Match: owner.ErrOwnerNotFound, Envelope: apierr.Envelope{
		Status:  http.StatusNotFound,
		Code:    "owner_not_found",
		Message: "owner handle not registered",
	}},
	{Match: inference.ErrOwnerProviderUnconfigured, Envelope: apierr.Envelope{
		Status:  http.StatusServiceUnavailable,
		Code:    "owner_ai_not_configured",
		Message: "owner has not connected an AI provider yet",
	}},
	{Match: session.ErrQueueTimeout, Envelope: apierr.Envelope{
		Status:  http.StatusServiceUnavailable,
		Code:    "server_busy",
		Message: "server busy; try again shortly",
	}},
	{Match: session.ErrSessionBusy, Envelope: apierr.Envelope{
		Status:  http.StatusTooManyRequests,
		Code:    "session_busy",
		Message: "previous message still streaming; wait for it to finish",
	}},
}

// authedVisitor —— bundled return of authVisitorWithToken; rich-return
// avoids funcresult-limit lint cap.
type authedVisitor struct {
	Data  *access.VisitorSessionData
	Token string
}

// visitorCtxKey —— withVisitorSession 把 authedVisitor 塞进 request context 的 key。
type visitorCtxKey struct{}

// withVisitorSession —— 访客 session 校验**装饰器**(中间件):bearer-token → Redis
// Sessions.Get 验过 → 把 authedVisitor 塞进 ctx 交给 next handler;验不过 → 401
// (响应已写,不进 handler)。所有需要 session 的访客路由统一套这一层,校验逻辑只此
// 一处 —— cookie 化 / 失效清理(401/403 清凭证)将来也只改这里。
func (h *Handlers) withVisitorSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := h.resolveVisitor(w, r)
		if !ok {
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), visitorCtxKey{}, av)))
	}
}

// resolveVisitor —— 真校验:bearer-token → VisitorSessionData(Redis)。token 留着给
// chat handler 派 BYOAI 信封的 HKDF 共享密钥。缺 token / session 失效(过期/evict/
// 删)→ 401,已写响应。
func (h *Handlers) resolveVisitor(
	w http.ResponseWriter, r *http.Request,
) (authedVisitor, bool) {
	token, has := visitorToken(r)
	if !has {
		writeError(h.Log, w, unauthorizedEnv("missing session token"))
		return authedVisitor{}, false
	}
	data, err := h.Sessions.Get(r.Context(), token)
	if err != nil {
		// session 失效(TTL 过期 / evict / 删)→ 顺手清掉浏览器 cookie,别再揣着死 token。
		clearVisitorSessionCookie(w)
		writeError(h.Log, w, unauthorizedEnv("invalid session"))
		return authedVisitor{}, false
	}
	return authedVisitor{Token: token, Data: &data}, true
}

// visitorSessionCookie —— 访客 session token 的 cookie 名。
const visitorSessionCookie = "sm_vsession"

// visitorToken —— 取访客 token:Authorization Bearer 优先,session cookie 兜底
// (跨 tab / 活过刷新 / SSR 都认)。
func visitorToken(r *http.Request) (string, bool) {
	if t, ok := bearerToken(r); ok {
		return t, true
	}
	return cookieToken(r)
}

func cookieToken(r *http.Request) (string, bool) {
	c, err := r.Cookie(visitorSessionCookie)
	if err != nil || c.Value == "" {
		return "", false
	}
	return c.Value, true
}

// setVisitorSessionCookie —— 发 session 时把 token 写进 HttpOnly cookie,寿命跟
// session 一致。HttpOnly = JS 读不到(防 XSS 偷),浏览器自动随请求带。
func setVisitorSessionCookie(
	w http.ResponseWriter, token string, expiresAt time.Time, secure bool,
) {
	http.SetCookie(w, &http.Cookie{
		Name: visitorSessionCookie, Value: token, Path: "/",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expiresAt,
	})
}

// clearVisitorSessionCookie —— session 失效(401)时回写一个过期 cookie 清掉它。
func clearVisitorSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: visitorSessionCookie, Value: "", Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// authVisitorWithToken —— handler 取 withVisitorSession 已验好的 authedVisitor
// (从 ctx 读)。保留旧名 + 签名,handler body 不动;装饰器没套到的路由 → 防御性 401。
func authVisitorWithToken(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (authedVisitor, bool) {
	av, ok := r.Context().Value(visitorCtxKey{}).(authedVisitor)
	if !ok {
		writeError(h.Log, w, unauthorizedEnv("missing bearer token"))
		return authedVisitor{}, false
	}
	return av, true
}

func unauthorizedEnv(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusUnauthorized, Code: "unauthorized", Message: msg}
}

func forbiddenEnv(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusForbidden, Code: "forbidden", Message: msg}
}

func bearerToken(r *http.Request) (string, bool) {
	const pfx = "Bearer "
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, pfx) {
		return "", false
	}
	return strings.TrimSpace(strings.TrimPrefix(h, pfx)), true
}

func handleVisitorErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, visitorErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("visitor flow", "err", err)
	}
	writeError(log, w, env)
}

// envBadReq / writeError 拆到 errors.go 守 max-lines 350。
