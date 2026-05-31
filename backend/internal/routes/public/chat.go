// Package public 提供 /api/v1/* 路由：visitor session 颁发 + chat SSE。
// 鉴权走 visitor session token（Bearer header）。CORS 开放（设计稿 D.2）。
package public

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// Handlers —— public routes 需要的依赖。
type Handlers struct {
	Visitor  usecases.VisitorDeps
	Sessions *session.VisitorSessionStore
	Log      *slog.Logger
}

// Mount 挂 /api/v1/* 路由。caller 负责前缀。
func (h *Handlers) Mount(r chi.Router) {
	r.Post("/sessions", h.createSession())
	r.Post("/sessions/{id}/messages", h.postMessage())
	r.Post("/sessions/{id}/summary", h.postSummary())
	r.Post("/sessions/{id}/tools/{tool_name}", h.toolDispatch())
	r.Post("/inference/models", h.listInferenceModels())
}

type parsedPostMessage struct {
	Content string
	BYOAI   *domain.AICredential
	Data    session.VisitorSessionData
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
	{Match: domain.ErrConversationEnded, Envelope: apierr.Envelope{
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

type postMessageRequest struct {
	Content string `json:"content"`
}

func (h *Handlers) postMessage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parsed, ok := preparePostMessage(h, w, r)
		if !ok {
			return
		}
		streamChatSSE(r, w, h, parsed, chi.URLParam(r, "id"))
	}
}

// preparePostMessage 校验 bearer + 解 body + 解 BYOAI 信封。失败时已写响
// 应 + 返 ok=false。
func preparePostMessage(
	h *Handlers, w http.ResponseWriter, r *http.Request,
) (*parsedPostMessage, bool) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return nil, false
	}
	parsed, bok := parseMessageBody(h, w, r, av.Data)
	if !bok {
		return nil, false
	}
	return enrichBYOAICreds(h, w, r, parsed, av.Token)
}

// authedVisitor —— authVisitorWithToken 多返打包（避开 funcresult-limit
// 2）。空 Data 表示 ok=false（即调用方读 ok 之后再用其他字段）。
type authedVisitor struct {
	Data  *session.VisitorSessionData
	Token string
}

// authVisitorWithToken —— 跟 Sessions.Get 一致；多回传一个 plain bearer
// token，chat path 用来做 BYOAI envelope 的 HKDF 派生（browser/server
// 唯一共享密钥）。
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

func parseMessageBody(
	h *Handlers, w http.ResponseWriter, r *http.Request, data *session.VisitorSessionData,
) (*parsedPostMessage, bool) {
	var req postMessageRequest
	if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
		writeError(h.Log, w, envBadReq("invalid JSON body"))
		return nil, false
	}
	return &parsedPostMessage{Content: req.Content, Data: *data}, true
}

func unauthorizedEnv(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusUnauthorized, Code: "unauthorized", Message: msg}
}

func streamChatSSE(
	r *http.Request, w http.ResponseWriter, h *Handlers,
	parsed *parsedPostMessage, convID string,
) {
	events, err := usecases.SendMessage(r.Context(), &h.Visitor, &usecases.SendMessageInput{
		OwnerID:        parsed.Data.OwnerID,
		ConversationID: convID,
		Body:           parsed.Content,
		Mode:           parsed.Data.Mode,
		BYOAI:          parsed.BYOAI,
		CodeID:         parsed.Data.CodeID,
		MaxBookings:    parsed.Data.MaxBookings,
		RoleSnapshot:   parsed.Data.RoleSnapshot,
		VisitorName:    parsed.Data.VisitorName,
	})
	if err != nil {
		handleVisitorErr(h.Log, w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	flusher, hasFlusher := w.(http.Flusher)
	if !hasFlusher {
		flusher = nil
	}
	pumpEvents(h.Log, w, flusher, events)
}

func pumpEvents(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	events <-chan usecases.MessageEvent,
) {
	for ev := range events {
		if !writeOneEvent(log, w, flusher, &ev) {
			return
		}
	}
}

// writeOneEvent 处理单个 event；返回 false 表示流终止。
// error 走 separate branch 让 cyclo ≤ 3；其它两种用 writeNormalEvent。
func writeOneEvent(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	ev *usecases.MessageEvent,
) bool {
	if ev.Kind == "error" {
		writeSSE(log, w, flusher, "error",
			marshalJSON(log, inferenceErrToPayloadStruct(ev.Err)))
		return false
	}
	writeNormalEvent(log, w, flusher, ev)
	return true
}

func writeNormalEvent(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	ev *usecases.MessageEvent,
) {
	switch ev.Kind {
	case "token":
		writeSSE(log, w, flusher, "token", marshalJSON(log, tokenPayload{Text: ev.Text}))
	case "done":
		writeSSE(log, w, flusher, "done",
			marshalJSON(log, donePayload{
				CitedWikiIDs:    ev.CitedWikiIDs,
				CitedOutputIDs:  ev.CitedOutputIDs,
				CitedWikiRefs:   ev.CitedWikiRefs,
				CitedOutputRefs: ev.CitedOutputRefs,
			}))
	default:
		// error 已经被 writeOneEvent 上游分支处理；其它 kind 暂时忽略
	}
}

// ssePayload —— marker interface 让 marshalJSON 不接 `any`（forbidigo 禁
// `any`，modernize 又抓 `interface{}`，互斥；marker 是 both-clean 的方案）。
type ssePayload interface{ sseMarker() }

type tokenPayload struct {
	Text string `json:"text"`
}

func (tokenPayload) sseMarker() {}

type donePayload struct {
	CitedWikiIDs    []string            `json:"cited_wiki_ids"`
	CitedOutputIDs  []string            `json:"cited_output_ids"`
	CitedWikiRefs   []usecases.CitedRef `json:"cited_wiki_refs"`
	CitedOutputRefs []usecases.CitedRef `json:"cited_output_refs"`
}

func (donePayload) sseMarker() {}

type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (errorPayload) sseMarker() {}

func marshalJSON(log *slog.Logger, v ssePayload) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		log.Error("sse marshal", "err", err)
		return []byte(`{}`)
	}
	return b
}

func inferenceErrToPayloadStruct(err error) errorPayload {
	return errorPayload{Code: inferenceErrCode(err), Message: err.Error()}
}

func inferenceErrCode(err error) string {
	codes := map[error]string{
		inference.ErrRateLimited:     "rate_limited",
		inference.ErrContextTooLong:  "context_too_long",
		inference.ErrInvalidAPIKey:   "byoai_key_invalid",
		inference.ErrPaymentRequired: "byoai_quota_exhausted",
		inference.ErrOverloaded:      "provider_overloaded",
		inference.ErrContentPolicy:   "content_policy",
		inference.ErrModelNotFound:   "model_not_found",
		inference.ErrServerSide:      "provider_error",
		inference.ErrTimeout:         "provider_timeout",
		inference.ErrNetwork:         "provider_unreachable",
	}
	for sentinel, code := range codes {
		if errors.Is(err, sentinel) {
			return code
		}
	}
	return "inference_error"
}

func writeSSE(
	log *slog.Logger, w http.ResponseWriter, flusher http.Flusher,
	event string, data []byte,
) {
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data); err != nil {
		log.Error("sse write", "err", err)
		return
	}
	if flusher != nil {
		flusher.Flush()
	}
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

func envBadReq(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

func writeError(log *slog.Logger, w http.ResponseWriter, env apierr.Envelope) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(env.Status)
	payload := map[string]map[string]string{
		"error": {"code": env.Code, "message": env.Message},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Error("encode error envelope", "err", err)
	}
}
