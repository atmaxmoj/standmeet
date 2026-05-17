// Package admin 提供 /api/admin/* 路由。M2 只有 first-run claim；M3 起
// 加 login / me / logout / tokens 等。
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

// Deps 是 admin handlers 需要的依赖。
type Deps struct {
	Claim     usecases.ClaimDeps
	Auth      AuthDeps
	APITokens usecases.APITokenDeps
	Corpus    CorpusDeps
	Log       *slog.Logger
}

// MountUnauthed 挂不需要 owner session 的 endpoint：claim / login。
func MountUnauthed(r chi.Router, deps Deps) {
	r.Post("/claim", claim(deps))
	r.Post("/login", login(deps))
}

// MountAuthed 挂需要 owner session 的 endpoint。caller 负责先用
// middleware.WithOwner 包这个 router。
func MountAuthed(r chi.Router, deps Deps) {
	r.Get("/me", me(deps))
	r.Post("/me/logout", logout(deps))
	r.Get("/csrf", csrfEndpoint(deps))
	r.Route("/tokens", func(r chi.Router) { MountTokens(r, deps) })
	MountCorpus(r, deps)
}

type claimRequest struct {
	Token    string `json:"token"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Handle   string `json:"handle"`
	FullName string `json:"full_name"`
}

type claimResponse struct {
	OwnerID  string `json:"owner_id"`
	Email    string `json:"email"`
	Handle   string `json:"handle"`
	FullName string `json:"full_name"`
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
}

// claim 是 first-run claim 的 thin handler：解 body、调 usecase、翻译错误。
func claim(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req claimRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(deps.Log, w, envBadReq("invalid JSON body"))
			return
		}

		owner, err := usecases.ClaimInstance(r.Context(), deps.Claim, &usecases.ClaimInput{
			Token: req.Token, Email: req.Email, Password: req.Password,
			Handle: req.Handle, FullName: req.FullName,
		})
		if err != nil {
			handleClaimErr(deps.Log, w, err)
			return
		}

		session.RemoveFirstRunFile(deps.Log)
		writeJSONClaim(deps.Log, w, &owner)
	}
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
		OwnerID:  owner.ID,
		Email:    owner.Email,
		Handle:   owner.Handle,
		FullName: owner.FullName,
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
