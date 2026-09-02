// chat.go —— /api/v1/* route mounting + visitor error-code table + auth/bearer helper.
// Chat data flow (post-#28):
//   - POST /sessions                issues a visitor session
//   - POST /agent/turn              eino ADK whole turn; sinks Dialog to the conversation
//                                   table at stream end (quota checked at entry) —
//                                   backend owns the turn, frontend only displays
//   - POST /sessions/{id}/tools/..  single tool execution
//   - GET  /report/{id}             read one chat report (I.3)
//
// POST /sessions/{id}/dialogs (frontend self-persists) is retired by #28: persistence is
// now one sink, at /agent/turn stream end. POST /summary (I.3) is gone too, replaced by
// the summarize_conversation capability.

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
	Outbound owner.OutboundSender // can it be sent out — the switch in /sessions's response
	// Owners —— name source for persona's opening "who are you" line (UX-66); unrelated to
	// corpus scope, so it's read straight off the owner row, not hoped for from retrieval.
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
	// Embeds —— embed-origin allowlist: issuing a session for a code exposed via an embed
	// only passes if Origin is allowlisted (embed HTML is public; pinning the origin is
	// the only stop against a leaked code being abused).
	Embeds *access.EmbedRepo
	// EmbedNonce —— one-time jti record for embed JWTs (replay protection, fail-closed).
	// Shares a Redis store with Sigv1.
	EmbedNonce   access.EmbedNonceStore
	QueryQueue   *session.QueryQueue
	Ledger       *conversation.WaypointLedger
	Ghosts       conversation.GhostDeps
	Log          *slog.Logger
	SecureCookie bool
}

// CodeGuard —— lockout port for failed access-code redemption (#169). impl =
// middleware.CodeGuard, injected in.
type CodeGuard interface {
	Locked(ctx context.Context, ip, captchaToken string) bool
	// HasLift —— true only when captcha is enabled; the rejection message's wording
	// follows this, else it'd describe a control that isn't on the screen.
	HasLift() bool
	RecordFail(ctx context.Context, ip string)
	Reset(ctx context.Context, ip string)
}

// UsageRecorder —— #106 billing port: records one owner-key LLM usage (BYOAI never goes
// through this — visitor-paid). Takes a whole row, not loose params, so provider + gas-
// spend flag don't get lost in the signature.
type UsageRecorder interface {
	Record(ctx context.Context, row *stats.UsageRow) error
}

// Mount wires /api/v1/* routes. Caller owns the prefix. Every route needing a visitor
// session is wrapped uniformly in the withVisitorSession decorator (validates + stuffs
// authedVisitor into ctx); the rest (issue session / peek code / list models) are bare.
func (h *Handlers) Mount(r chi.Router) {
	// ── no session required ──
	r.Post("/sessions", h.createSession())
	// codes/intro —— public pre-issue peek for the name picker (code travels in the body,
	// never lands in the URL log).
	r.Post("/codes/intro", h.codeIntro())
	r.Post("/inference/models", h.listInferenceModels())

	// ── requires a visitor session (validated uniformly by the decorator) ──
	// F-L-11 liveness probe on reader/chat mount: checks whether the stored token is
	// still alive (TTL expired → 401), so the frontend drops the fake "unlocked" chrome
	// of an expired session instead of trusting localStorage indefinitely.
	r.Get("/session", h.withVisitorSession(h.getSessionInfo()))
	// refresh recovery: returns the whole session aggregate (session + code + conversation)
	// so the frontend hydrates in one shot. Scope is locked by the token (member → open
	// chat); the URL {id} exists only for RESTful shape.
	r.Get("/conversations/{id}", h.withVisitorSession(h.getConversation()))
	// multi-conversation model: a floating panel on a doc finds-or-creates its own
	// conversation (independent of main chat, sharing member-level quota).
	// body {doc_key} → {conversation_id, conversation}.
	r.Post("/conversations", h.withVisitorSession(h.openDocConversation()))
	// Same dispatch handler wired for POST and QUERY. QUERY (RFC 10008) is the
	// semantically correct entry for read-only tools (corpus_search/read/list/links) —
	// safe/idempotent + carries a body; a state-changing tool via QUERY → 405 (gated in
	// tools.go). POST still works for every tool (backward compatible).
	toolDisp := h.withVisitorSession(h.toolDispatch())
	r.Post("/sessions/{id}/tools/{tool_name}", toolDisp)
	r.Method(methodQuery, "/sessions/{id}/tools/{tool_name}", toolDisp)
	// MCP App state across refreshes: a sandboxed card CRUDs its own MCP slot through the
	// host. mcp_id is derived from {tool}.
	r.Get("/sessions/{id}/app-state/{tool}", h.withVisitorSession(h.getAppState()))
	r.Put("/sessions/{id}/app-state/{tool}/{key}", h.withVisitorSession(h.setAppState()))
	r.Delete("/sessions/{id}/app-state/{tool}/{key}", h.withVisitorSession(h.deleteAppState()))
	// #122/#123: once a booking is confirmed, a card button (send confirmation email /
	// cancel) dispatches straight to the sandboxed booker's own tool via mcp-ui:tool
	// (send_confirmation / calendar_cancel) — no matching REST route on the host anymore.
	// The old cancel route had two host-side implementations (owner + visitor) plus the
	// sandbox's own copy, three ways of writing the same thing; both are retired.
	// #123: a visitor cancels a meeting they booked — isolated in a usecase (resolves
	// event_id via owner+code+member); not this member's → 404. No AI involved.
	// I.3: /report/{id} fetches one chat_reports row (visitor browser via the standalone
	// /report/[id] route; owner side gets its own admin route later).
	r.Get("/report/{id}", h.withVisitorSession(h.getReport()))
	r.Get("/report/{id}/pdf", h.withVisitorSession(h.getReportPDF()))
	r.Post("/llm/chat/stream", h.withVisitorSession(h.llmChatStream()))
	// H.9: new agent-turn entry point, runs through eino ADK ChatModelAgent. SDK cuts
	// over in H.10; /llm/chat/stream retires once H.10 lands.
	r.Post("/agent/turn", h.withVisitorSession(h.agentTurn()))
	// H.13.e: ghost-text logging write path. shown writes one row the moment the browser
	// renders a ghost; accept fires on Tab; owner admin detail page reads these.
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
		// "doesn't exist" and "was revoked" used to share one message, "invalid or
		// revoked" — but the next step differs: a typo means paste again, a revocation
		// means go get a new one. Merged, neither person knew what to do (F-D-6).
		Message: "no such access code — check it and paste it again",
	}},
	{Match: access.ErrCodeRevoked, Envelope: apierr.Envelope{
		Status: http.StatusUnauthorized,
		Code:   "code_revoked",
		// Names the next step, not the state: retrying never works again.
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
		// Says nothing about tokens/gas/whose money — nothing the visitor can do about
		// it — and promises no "owner notified", a promise nobody implements.
		Message: "this conversation has reached its usage limit",
	}},
	{Match: access.ErrPeriodLimitReached, Envelope: apierr.Envelope{
		Status:  http.StatusForbidden,
		Code:    "period_limit_reached",
		Message: "this code has reached its limit for now — try again later",
	}},
	{Match: access.ErrEmbedOriginNotAllowed, Envelope: apierr.Envelope{
		Status:  http.StatusForbidden,
		Code:    "origin_not_allowed",
		Message: "this widget is not enabled for this site",
	}},
	{Match: access.ErrEmbedTokenInvalid, Envelope: apierr.Envelope{
		Status: http.StatusUnauthorized,
		Code:   "embed_token_invalid",
		// A single sentinel message — doesn't say bad/expired/replayed, so gives no
		// oracle to probe; the widget just re-signs a new one.
		Message: "this widget could not be verified — reload the page and try again",
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

// visitorCtxKey —— the key withVisitorSession uses to stuff authedVisitor into the
// request context.
type visitorCtxKey struct{}

// withVisitorSession —— the visitor session validation **decorator** (middleware):
// bearer-token → validated via Redis Sessions.Get → authedVisitor stuffed into ctx and
// passed to next handler; fails validation → 401 (response written, handler never runs).
// Every session-needing route is wrapped uniformly in this one layer, so cookie changes
// and failure cleanup (401/403 clearing credentials) only ever change here.
func (h *Handlers) withVisitorSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		av, ok := h.resolveVisitor(w, r)
		if !ok {
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), visitorCtxKey{}, av)))
	}
}

// resolveVisitor —— the real validation: bearer-token → VisitorSessionData (Redis). Token
// is kept for the chat handler to derive the BYOAI envelope's HKDF shared secret. Missing
// token / invalidated session (expired/evicted/deleted) → 401, response already written.
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
		// session invalidated (TTL expired / evicted / deleted) → clear the browser
		// cookie while we're at it, don't let it keep carrying a dead token.
		clearVisitorSessionCookie(w)
		writeError(h.Log, w, unauthorizedEnv("invalid session"))
		return authedVisitor{}, false
	}
	return authedVisitor{Token: token, Data: &data}, true
}

// visitorSessionCookie —— the cookie name for the visitor session token.
const visitorSessionCookie = "sm_vsession"

// visitorToken —— fetches the visitor token: Authorization Bearer first, session cookie
// as fallback (works across tabs, survives refresh, recognized by SSR too).
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

// setVisitorSessionCookie —— on session issue, writes the token into an HttpOnly cookie
// with a matching lifetime. HttpOnly = JS can't read it (guards XSS theft); the browser
// sends it automatically with every request.
func setVisitorSessionCookie(
	w http.ResponseWriter, token string, expiresAt time.Time, secure bool,
) {
	http.SetCookie(w, &http.Cookie{
		Name: visitorSessionCookie, Value: token, Path: "/",
		HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expiresAt,
	})
}

// clearVisitorSessionCookie —— when a session is invalidated (401), writes back an
// expired cookie to clear it.
func clearVisitorSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: visitorSessionCookie, Value: "", Path: "/",
		HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

// authVisitorWithToken —— fetches the authedVisitor already validated by withVisitorSession
// (read from ctx); keeps the old name/signature so handler bodies don't change. A route
// the decorator didn't wrap → defensive 401.
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

// envBadReq / writeError are split into errors.go to stay under the max-lines-350 limit.
