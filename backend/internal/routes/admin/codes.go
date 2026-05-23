// codes.go —— admin /codes endpoint：create / list / revoke / quotas.

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// CodesDeps —— admin codes handlers 依赖。
type CodesDeps struct {
	Codes *postgres.CodeRepo
}

type createCodeRequest struct {
	MaxSessionsPerMember *int32                  `json:"max_sessions_per_member,omitempty"`
	MaxTurnsPerSession   *int32                  `json:"max_turns_per_session,omitempty"`
	Code                 string                  `json:"code"`
	Label                string                  `json:"label"`
	Purpose              string                  `json:"purpose"`
	CorpusPermissions    []domain.PathPermission `json:"corpus_permissions"`
	SuggestedQuestions   []string                `json:"suggested_questions"`
}

type updateQuotasRequest struct {
	MaxSessionsPerMember *int32 `json:"max_sessions_per_member,omitempty"`
	MaxTurnsPerSession   *int32 `json:"max_turns_per_session,omitempty"`
}

type codeView struct {
	CreatedAt            string                  `json:"created_at"`
	MaxSessionsPerMember *int32                  `json:"max_sessions_per_member,omitempty"`
	MaxTurnsPerSession   *int32                  `json:"max_turns_per_session,omitempty"`
	ID                   string                  `json:"id"`
	Code                 string                  `json:"code"`
	Label                string                  `json:"label"`
	Status               string                  `json:"status"`
	CorpusPermissions    []domain.PathPermission `json:"corpus_permissions"`
	SuggestedQuestions   []string                `json:"suggested_questions"`
}

// MountCodes 挂 /codes 子路由。
func (h *Handlers) MountCodes(r chi.Router) {
	r.Get("/", h.listCodes())
	r.Post("/", h.createCode())
	r.Post("/{id}/revoke", h.revokeCode())
	r.Patch("/{id}/quotas", h.updateCodeQuotas())
	r.Get("/{id}/members", h.listCodeMembers())
}

func (h *Handlers) listCodes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.CodesAdmin.Codes.ListByOwner(r.Context(), ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list codes", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeCodesList(h.Log, w, rows)
	}
}

func writeCodesList(log *slog.Logger, w http.ResponseWriter, rows []domain.AccessCode) {
	items := make([]codeView, 0, len(rows))
	for i := range rows {
		items = append(items, toCodeView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(log, "encode codes", err)
	}
}

func toCodeView(c *domain.AccessCode) codeView {
	return codeView{
		ID:                   c.ID,
		Code:                 c.Code,
		Label:                c.Label,
		Status:               c.Status,
		CorpusPermissions:    c.CorpusPermissions,
		SuggestedQuestions:   c.SuggestedQuestions,
		CreatedAt:            c.CreatedAt.Format(time.RFC3339),
		MaxSessionsPerMember: c.MaxSessionsPerMember,
		MaxTurnsPerSession:   c.MaxTurnsPerSession,
	}
}

func (h *Handlers) createCode() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		code, err := h.CodesAdmin.Codes.Create(r.Context(), buildCreateInput(ownerID, &req))
		if err != nil {
			logEncodeErr(h.Log, "create code", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeCreatedCode(h.Log, w, &code)
	}
}

func buildCreateInput(ownerID string, req *createCodeRequest) *postgres.CreateCodeInput {
	return &postgres.CreateCodeInput{
		OwnerID:              ownerID,
		Code:                 req.Code,
		Label:                req.Label,
		Purpose:              req.Purpose,
		CorpusPermissions:    req.CorpusPermissions,
		SuggestedQuestions:   req.SuggestedQuestions,
		MaxSessionsPerMember: req.MaxSessionsPerMember,
		MaxTurnsPerSession:   req.MaxTurnsPerSession,
	}
}

func writeCreatedCode(log *slog.Logger, w http.ResponseWriter, c *domain.AccessCode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(toCodeView(c)); err != nil {
		logEncodeErr(log, "encode code", err)
	}
}

func (h *Handlers) revokeCode() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		codeID := chi.URLParam(r, "id")
		if err := h.CodesAdmin.Codes.Revoke(r.Context(), ownerID, codeID); err != nil {
			logEncodeErr(h.Log, "revoke code", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handlers) updateCodeQuotas() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req updateQuotasRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		codeID := chi.URLParam(r, "id")
		updated, err := h.CodesAdmin.Codes.UpdateQuotas(
			r.Context(), ownerID, codeID, req.MaxSessionsPerMember, req.MaxTurnsPerSession,
		)
		if err != nil {
			handleUpdateQuotasErr(h.Log, w, err)
			return
		}
		writeQuotaResp(h.Log, w, &updated)
	}
}

func handleUpdateQuotasErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrCodeInvalid) {
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "code_not_found", Message: "code not found",
		})
		return
	}
	logEncodeErr(log, "update code quotas", err)
	writeError(log, w, serverErr())
}

func writeQuotaResp(log *slog.Logger, w http.ResponseWriter, c *domain.AccessCode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toCodeView(c)); err != nil {
		logEncodeErr(log, "encode code", err)
	}
}

type memberView struct {
	LastSeenAt  string `json:"last_seen_at,omitempty"`
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email,omitempty"`
	IsAnonymous bool   `json:"is_anonymous"`
}

func (h *Handlers) listCodeMembers() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		codeID := chi.URLParam(r, "id")
		members, err := h.CodesAdmin.Codes.ListMembers(r.Context(), codeID)
		if err != nil {
			logEncodeErr(h.Log, "list members", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeMembersList(h.Log, w, members)
	}
}

func writeMembersList(log *slog.Logger, w http.ResponseWriter, ms []domain.CodeMember) {
	items := make([]memberView, 0, len(ms))
	for i := range ms {
		items = append(items, toMemberView(&ms[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(log, "encode members", err)
	}
}

func toMemberView(m *domain.CodeMember) memberView {
	return memberView{
		ID:          m.ID,
		DisplayName: m.DisplayName,
		Email:       m.Email,
		IsAnonymous: m.IsAnonymous,
		LastSeenAt:  formatOptionalTime(m.LastSeenAt),
	}
}

func formatOptionalTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
