// codes.go —— admin /codes endpoint：create / list / revoke / quotas.

package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// CodesDeps —— admin codes handlers 依赖。Roles 用来 owner 不显式给
// assumed_role_id 时查 vanilla 兜底。Sessions:revoke 时清掉这张 code 的 visitor
// session(token 真死,下一请求被发现无效 → 401 + 清 cookie)。
type CodesDeps struct {
	Codes    *postgres.CodeRepo
	Roles    *postgres.RoleRepo
	Sessions *session.VisitorSessionStore
	Denials  *postgres.CodeDenialRepo // ACL code 层 deny 读写
}

type createCodeRequest struct {
	MaxMembers         *int32   `json:"max_members,omitempty"`
	MaxTurnsPerSession *int32   `json:"max_turns_per_session,omitempty"`
	MaxBookings        *int32   `json:"max_bookings,omitempty"`
	AssumedRoleID      *string  `json:"assumed_role_id,omitempty"`
	Code               string   `json:"code"`
	Label              string   `json:"label"`
	Purpose            string   `json:"purpose"`
	Ghosts             []string `json:"ghosts"`
}

type updateQuotasRequest struct {
	MaxMembers         *int32 `json:"max_members,omitempty"`
	MaxTurnsPerSession *int32 `json:"max_turns_per_session,omitempty"`
}

type codeView struct {
	CreatedAt          string   `json:"created_at"`
	ExpiresAt          *string  `json:"expires_at,omitempty"`
	MaxMembers         *int32   `json:"max_members,omitempty"`
	MaxTurnsPerSession *int32   `json:"max_turns_per_session,omitempty"`
	MaxBookings        *int32   `json:"max_bookings"`
	ID                 string   `json:"id"`
	Code               string   `json:"code"`
	Label              string   `json:"label"`
	Status             string   `json:"status"`
	AssumedRoleID      string   `json:"assumed_role_id"`
	Ghosts             []string `json:"ghosts"`
}

// MountCodes 挂 /codes 子路由。
func (h *Handlers) MountCodes(r chi.Router) {
	r.Get("/", h.listCodes())
	r.Post("/", h.createCode())
	r.Post("/{id}/revoke", h.revokeCode())
	r.Patch("/{id}/quotas", h.updateCodeQuotas())
	r.Get("/{id}/members", h.listCodeMembers())
	// ACL code 层 deny（capability-acl-hierarchy.md）。
	r.Get("/{id}/denials", h.listCodeDenials())
	r.Post("/{id}/capability-denials", h.addCapabilityDenial())
	r.Delete("/{id}/capability-denials/{capId}", h.deleteCapabilityDenial())
	r.Post("/{id}/skill-denials", h.addSkillDenial())
	r.Delete("/{id}/skill-denials/{skillId}", h.deleteSkillDenial())
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
		writeCodesList(r, h, w, rows)
	}
}

func writeCodesList(
	_ *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.AccessCode,
) {
	items := make([]codeView, 0, len(rows))
	for i := range rows {
		items = append(items, toCodeView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode codes", err)
	}
}

func toCodeView(c *domain.AccessCode) codeView {
	return codeView{
		ID:                 c.ID,
		Code:               c.Code,
		Label:              c.Label,
		Status:             c.Status,
		Ghosts:             c.Ghosts,
		CreatedAt:          c.CreatedAt.Format(time.RFC3339),
		ExpiresAt:          rfc3339OrNil(c.ExpiresAt),
		MaxMembers:         c.MaxMembers,
		MaxTurnsPerSession: c.MaxTurnsPerSession,
		MaxBookings:        c.MaxBookings,
		AssumedRoleID:      c.AssumedRoleID,
	}
}

// rfc3339OrNil —— 可空时间 → 可空 RFC3339 字符串(nil 透传,前端不显 expiry)。
func rfc3339OrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

func (h *Handlers) createCode() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createCodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		runCreateCode(r, h, w, &req)
	}
}

// runCreateCode —— 拆出 createCode 的 happy/error path 让 handler cyclo≤3。
// assumed_role_id 缺省 → 用 owner 的 vanilla（claim 时种入）。
func runCreateCode(
	r *http.Request, h *Handlers, w http.ResponseWriter, req *createCodeRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	ensureCodePlaintext(req)
	in, ierr := buildCreateInput(r, h, ownerID, req)
	if ierr != nil {
		logEncodeErr(h.Log, "build code input", ierr)
		writeError(h.Log, w, serverErr())
		return
	}
	code, err := h.CodesAdmin.Codes.Create(r.Context(), in)
	if err != nil {
		handleCreateCodeErr(h.Log, w, err)
		return
	}
	writeCreatedCode(h.Log, w, &code)
}

var createCodeErrCases = []apierr.Case{
	{
		Match: domain.ErrCodeTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "code_taken",
			Message: "That access code already exists.",
		},
	},
}

func handleCreateCodeErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, createCodeErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "create code", err)
	}
	writeError(log, w, env)
}

func buildCreateInput(
	r *http.Request, h *Handlers, ownerID string, req *createCodeRequest,
) (*postgres.CreateCodeInput, error) {
	roleID, rerr := resolveCodeRoleID(r, h, ownerID, req.AssumedRoleID)
	if rerr != nil {
		return nil, rerr
	}
	return &postgres.CreateCodeInput{
		OwnerID:            ownerID,
		Code:               req.Code,
		Label:              req.Label,
		Purpose:            req.Purpose,
		Ghosts:             req.Ghosts,
		MaxMembers:         req.MaxMembers,
		MaxTurnsPerSession: req.MaxTurnsPerSession,
		MaxBookings:        req.MaxBookings,
		AssumedRoleID:      roleID,
	}, nil
}

// resolveCodeRoleID —— 显式给 → 直接用；没给 → 查 owner 的 vanilla role。
func resolveCodeRoleID(
	r *http.Request, h *Handlers, ownerID string, requested *string,
) (string, error) {
	if explicit := nonEmptyPtr(requested); explicit != "" {
		return explicit, nil
	}
	return lookupVanillaRoleID(r, h, ownerID)
}

func nonEmptyPtr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func lookupVanillaRoleID(r *http.Request, h *Handlers, ownerID string) (string, error) {
	vanilla, err := h.CodesAdmin.Roles.GetByName(r.Context(), ownerID, domain.VanillaRoleName)
	if err != nil {
		return "", fmt.Errorf("get vanilla role: %w", err)
	}
	return vanilla.ID(), nil
}

func writeCreatedCode(log *slog.Logger, w http.ResponseWriter, c *domain.AccessCode) {
	v := toCodeView(c)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(v); err != nil {
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
		// 清掉这张 code 已发出的 visitor session(token 真死);失败不致命 —— 持码人
		// 下一 turn 仍会被 per-turn 的 code-revoked 检查挡(只是 cookie 暂不清)。
		if derr := h.CodesAdmin.Sessions.DeleteByCode(r.Context(), codeID); derr != nil {
			h.Log.Error("revoke: purge visitor sessions", "err", derr)
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
			r.Context(), ownerID, codeID, req.MaxTurnsPerSession, req.MaxMembers,
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
