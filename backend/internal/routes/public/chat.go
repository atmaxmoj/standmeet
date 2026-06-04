// chat.go —— /api/v1/* 路由挂载 + visitor 错误码表 + auth/bearer helper。
// Chat 数据流（H.3 之后）：
//   - POST /sessions               颁发 visitor session
//   - POST /llm/chat/stream        eino-backed unified SSE 入口；浏览器
//                                  pi-agent-core 跑 LLM ↔ tool loop
//   - POST /sessions/{id}/tools/.. 单 tool 执行
//   - POST /sessions/{id}/dialogs  整 turn 结束后 commit 一段 Dialog
//   - POST /sessions/{id}/summary  整段对话生成 summary 报告
//
// H.3 删了 server-side byte-proxy (/inference/stream + OpenAnthropicStream)。
// 所有 chat 推理走 pi-agent-core in browser → /llm/chat/stream (pi unified
// SSE) → backend eino model.ToolCallingChatModel → upstream provider。

package public

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/session"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// Handlers —— public routes deps.
type Handlers struct {
	Visitor     usecases.VisitorDeps
	Sessions    *session.VisitorSessionStore
	Corpus      usecases.DialogCorpusLookup
	Suggestions usecases.SuggestionDeps
	Log         *slog.Logger
}

// Mount 挂 /api/v1/* 路由。caller 负责前缀。
func (h *Handlers) Mount(r chi.Router) {
	r.Post("/sessions", h.createSession())
	r.Post("/sessions/{id}/dialogs", h.postDialog())
	r.Post("/sessions/{id}/summary", h.postSummary())
	r.Post("/sessions/{id}/tools/{tool_name}", h.toolDispatch())
	r.Post("/inference/models", h.listInferenceModels())
	r.Post("/llm/chat/stream", h.llmChatStream())
	// H.9: 新 agent turn 入口；走 eino ADK ChatModelAgent。SDK 在 H.10
	// 切到这条；H.10 land 后 /llm/chat/stream 退役。
	r.Post("/agent/turn", h.agentTurn())
	// H.13.e: ghost text 日志写路径。shown 在浏览器渲 ghost 时一次性
	// 写一行；accept 在 visitor 按 Tab 时调；owner admin 详情页读这些。
	r.Post("/sessions/{id}/suggestions/shown", h.postSuggestionShown())
	r.Post("/sessions/{id}/suggestions/{sid}/accept", h.postSuggestionAccept())
}

var visitorErrCases = []apierr.Case{
	{Match: usecases.ErrEmptyField, Envelope: apierr.Envelope{
		Status: http.StatusBadRequest, Code: "bad_request", Message: "missing required field",
	}},
	{Match: domain.ErrCodeInvalid, Envelope: apierr.Envelope{
		Status:  http.StatusUnauthorized,
		Code:    "code_invalid",
		Message: "access code invalid or revoked",
	}},
	{Match: domain.ErrCodeExpired, Envelope: apierr.Envelope{
		Status: http.StatusUnauthorized, Code: "code_expired", Message: "access code expired",
	}},
	{Match: domain.ErrSessionQuotaReached, Envelope: apierr.Envelope{
		Status:  http.StatusForbidden,
		Code:    "session_quota_reached",
		Message: "no more sessions left for this visitor",
	}},
	{Match: domain.ErrTurnQuotaReached, Envelope: apierr.Envelope{
		Status:  http.StatusForbidden,
		Code:    "turn_quota_reached",
		Message: "this session has reached its turn limit",
	}},
	{Match: domain.ErrOwnerNotFound, Envelope: apierr.Envelope{
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
	{Match: domain.ErrChatEnded, Envelope: apierr.Envelope{
		Status:  http.StatusGone,
		Code:    "conversation_ended",
		Message: "conversation has been summarized; start a new session to continue",
	}},
	{Match: usecases.ErrSummaryEmptyConv, Envelope: apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "summary_empty",
		Message: "no messages to summarize",
	}},
}

// authedVisitor —— bundled return of authVisitorWithToken; rich-return
// avoids funcresult-limit lint cap.
type authedVisitor struct {
	Data  *session.VisitorSessionData
	Token string
}

// authVisitorWithToken —— bearer-token → VisitorSessionData. Token is
// kept around so chat handlers can derive the HKDF shared secret used
// by BYOAI envelopes.
func authVisitorWithToken(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (authedVisitor, bool) {
	token, hasBearer := bearerToken(r)
	if !hasBearer {
		writeError(h.Log, w, unauthorizedEnv("missing bearer token"))
		return authedVisitor{}, false
	}
	data, err := h.Sessions.Get(r.Context(), token)
	if err != nil {
		writeError(h.Log, w, unauthorizedEnv("invalid session"))
		return authedVisitor{}, false
	}
	return authedVisitor{Token: token, Data: &data}, true
}

func unauthorizedEnv(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusUnauthorized, Code: "unauthorized", Message: msg}
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
