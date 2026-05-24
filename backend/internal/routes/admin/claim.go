// Package admin 提供 /api/admin/* 路由。当前覆盖 first-run claim、
// login / me / logout / tokens 等。
//
// handler cyclo ≤ 3（routes 层强制）；业务逻辑放 usecase，error 翻译
// 走 internal/apierr/ 的 table-driven Classify。
package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// Handlers 是 admin handlers 需要的依赖。
type Handlers struct {
	Claim           usecases.ClaimDeps
	Auth            AuthDeps
	APITokens       usecases.APITokenDeps
	Corpus          CorpusDeps
	CodesAdmin      CodesDeps
	PageAdmin       PageAdminDeps
	SEOAdmin        SEOAdminDeps
	Conversations   ConversationsDeps
	BYOAI           BYOAIDeps
	Domains         DomainsDeps
	AccessRequests  AccessRequestsDeps
	HandleAdmin     HandleDeps
	PublicURLAdmin  PublicURLDeps
	AccountAdmin    AccountDeps
	AIProviderAdmin AIProviderDeps
	CustomPages     usecases.CustomPageDeps
	SkillsAdmin     SkillsAdminDeps
	Log             *slog.Logger
	SecureCookie    bool // false 仅限 dev (http)；prod 必须 true。
}

// MountUnauthed 挂不需要 owner session 的 endpoint：claim / login。
// loginGuard 是 brute-force 防御（per-IP rate-limit + equal-time response），
// 只裹 /login —— claim 用一次性 setup token，brute-force 不实际。
func (h *Handlers) MountUnauthed(
	r chi.Router, loginGuard func(http.Handler) http.Handler,
) {
	r.Post("/claim", h.claim())
	r.Group(func(r chi.Router) {
		r.Use(loginGuard)
		r.Post("/login", h.login())
	})
}

// MountAuthed 挂需要 owner session 的 endpoint。caller 负责先用
// middleware.WithOwner 包这个 router。
func (h *Handlers) MountAuthed(r chi.Router) {
	r.Get("/me", h.me())
	r.Post("/me/logout", h.logout())
	r.Get("/csrf", h.csrfEndpoint())
	r.Route("/tokens", func(r chi.Router) { h.MountTokens(r) })
	r.Route("/codes", func(r chi.Router) { h.MountCodes(r) })
	h.MountCorpus(r)
	h.MountCorpusCRUD(r)
	h.MountConversations(r)
	h.MountBYOAI(r)
	h.MountDomains(r)
	h.MountPage(r)
	h.MountSEO(r)
	h.MountAccessRequests(r)
	h.MountHandle(r)
	h.MountPublicURL(r)
	h.MountAccount(r)
	h.MountAIProvider(r)
	h.MountCustomPages(r)
	h.MountSkills(r)
}

type claimRequest struct {
	Token     string `json:"token"`
	Email     string `json:"email"`
	Password  string `json:"password"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
}

type claimResponse struct {
	OwnerID   string `json:"owner_id"`
	Email     string `json:"email"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
}

// envelope helpers 让 line-length 不超 100。
func envBadReq(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}

// claimErrCases 把 ClaimInstance 可能 propagate 的 sentinel error 翻译成
// HTTP envelope。顺序无关（errors.Is 走的是 unwrap chain）。
var claimErrCases = []apierr.Case{
	{
		Match:    usecases.ErrEmptyField,
		Envelope: envBadReq("missing required field"),
	},
	{
		Match: domain.ErrInvalidSetupToken,
		Envelope: apierr.Envelope{
			Status:  http.StatusUnauthorized,
			Code:    "invalid_setup_token",
			Message: "setup token is invalid or already consumed",
		},
	},
	{
		Match: domain.ErrEmailTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "email_taken", Message: "email already in use",
		},
	},
	{
		Match: domain.ErrHandleTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "handle_taken", Message: "handle already in use",
		},
	},
	{
		Match: usecases.ErrPublicURLInvalid,
		Envelope: apierr.Envelope{
			Status:  http.StatusBadRequest,
			Code:    "public_url_invalid",
			Message: "public_url must be a full URL with http(s):// scheme",
		},
	},
}

// claim 是 first-run claim 的 thin handler：解 body、调 usecase、翻译错误 +
// 顺便登录（claim 成功 = owner 凭 setup token 证明了对 instance 的所有权，
// 让 owner 再次输同一份 email/password 是 UX 浪费）。
func (h *Handlers) claim() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req claimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		h.runClaimAndAutoLogin(w, r, &req)
	}
}

// runClaimAndAutoLogin —— 把 cyclo 控在 ≤3：handler 只做 decode + 派发。
func (h *Handlers) runClaimAndAutoLogin(
	w http.ResponseWriter, r *http.Request, req *claimRequest,
) {
	owner, err := usecases.ClaimInstance(r.Context(), h.Claim, &usecases.ClaimInput{
		Token: req.Token, Email: req.Email, Password: req.Password,
		Handle: req.Handle, FullName: req.FullName, PublicURL: req.PublicURL,
	})
	if err != nil {
		handleClaimErr(h.Log, w, err)
		return
	}
	loggedIn, lerr := usecases.Login(r.Context(), h.Auth.Login, &usecases.LoginInput{
		Email: req.Email, Password: req.Password,
	})
	if lerr != nil {
		h.Log.Error("auto-login after claim failed", "err", lerr)
		writeError(h.Log, w, serverErr())
		return
	}
	setSessionCookies(w, loggedIn.SessionToken, loggedIn.CSRFToken, h.SecureCookie)
	session.RemoveFirstRunFile(h.Log)
	writeJSONClaim(h.Log, w, &owner)
}

func handleClaimErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, claimErrCases)
	if env.Status >= http.StatusInternalServerError {
		log.Error("claim failed", "err", err)
	}
	writeError(log, w, env)
}

func writeJSONClaim(log *slog.Logger, w http.ResponseWriter, owner *domain.Owner) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := claimResponse{
		OwnerID:   owner.ID,
		Email:     owner.Email,
		Handle:    owner.Handle,
		FullName:  owner.FullName,
		PublicURL: owner.PublicURL,
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode claim response", "err", err)
	}
}

func writeError(log *slog.Logger, w http.ResponseWriter, env apierr.Envelope) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(env.Status)
	payload := map[string]map[string]string{
		"error": {"code": env.Code, "message": env.Message},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Error("encode error response", "err", err)
	}
}
