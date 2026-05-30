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
	"github.com/wangsijie/standmeet/internal/usecases"
)

// CodesDeps —— admin codes handlers 依赖。
type CodesDeps struct {
	Codes      *postgres.CodeRepo
	Skills     *postgres.SkillRepo
	MCPServers *postgres.MCPServerRepo
}

type createCodeRequest struct {
	MaxSessionsPerMember *int32                  `json:"max_sessions_per_member,omitempty"`
	MaxTurnsPerSession   *int32                  `json:"max_turns_per_session,omitempty"`
	MaxBookings          *int32                  `json:"max_bookings,omitempty"`
	AssumedRoleID        *string                 `json:"assumed_role_id,omitempty"`
	Code                 string                  `json:"code"`
	Label                string                  `json:"label"`
	Purpose              string                  `json:"purpose"`
	CorpusPermissions    []domain.PathPermission `json:"corpus_permissions"`
	SuggestedQuestions   []string                `json:"suggested_questions"`
	SkillIDs             []string                `json:"skill_ids,omitempty"`
	MCPServerIDs         []string                `json:"mcp_server_ids,omitempty"`
	GrantedSkills        []string                `json:"granted_skills,omitempty"`
}

type updateQuotasRequest struct {
	MaxSessionsPerMember *int32 `json:"max_sessions_per_member,omitempty"`
	MaxTurnsPerSession   *int32 `json:"max_turns_per_session,omitempty"`
}

type codeView struct {
	CreatedAt            string                  `json:"created_at"`
	MaxSessionsPerMember *int32                  `json:"max_sessions_per_member,omitempty"`
	MaxTurnsPerSession   *int32                  `json:"max_turns_per_session,omitempty"`
	MaxBookings          *int32                  `json:"max_bookings"`
	AssumedRoleID        *string                 `json:"assumed_role_id,omitempty"`
	ID                   string                  `json:"id"`
	Code                 string                  `json:"code"`
	Label                string                  `json:"label"`
	Status               string                  `json:"status"`
	CorpusPermissions    []domain.PathPermission `json:"corpus_permissions"`
	SuggestedQuestions   []string                `json:"suggested_questions"`
	SkillIDs             []string                `json:"skill_ids,omitempty"`
	MCPServerIDs         []string                `json:"mcp_server_ids,omitempty"`
	GrantedSkills        []string                `json:"granted_skills"`
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
		writeCodesList(r, h, w, rows)
	}
}

func writeCodesList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.AccessCode,
) {
	items := make([]codeView, 0, len(rows))
	for i := range rows {
		v := toCodeView(&rows[i])
		v.SkillIDs = listSkillIDsForCode(r, h, rows[i].ID)
		v.MCPServerIDs = listMCPServerIDsForCode(r, h, rows[i].ID)
		items = append(items, v)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode codes", err)
	}
}

// listSkillIDsForCode —— N+1 拉每个 code 的 skill_ids。V1 owner 数据量小可接受；
// 真要优化加一个 JOIN 查询返 map[code_id]→[]skill_id。
func listSkillIDsForCode(r *http.Request, h *Handlers, codeID string) []string {
	if h.CodesAdmin.Skills == nil {
		return []string{}
	}
	ids, err := h.CodesAdmin.Skills.ListSkillIDsForCode(r.Context(), codeID)
	if err != nil {
		h.Log.Error("list code skill ids", "code_id", codeID, "err", err)
		return []string{}
	}
	return ids
}

func toCodeView(c *domain.AccessCode) codeView {
	grants := c.GrantedSkills
	if grants == nil {
		grants = []string{}
	}
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
		MaxBookings:          c.MaxBookings,
		GrantedSkills:        grants,
		AssumedRoleID:        c.AssumedRoleID,
	}
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
// attach 阶段失败时由 attachCreatedCodeAssoc 写 envelope；本函数只把分支
// 减到 ≤3 路。
func runCreateCode(
	r *http.Request, h *Handlers, w http.ResponseWriter, req *createCodeRequest,
) {
	ownerID := middleware.OwnerIDFrom(r.Context())
	ensureCodePlaintext(req)
	code, err := h.CodesAdmin.Codes.Create(r.Context(), buildCreateInput(ownerID, req))
	if err != nil {
		logEncodeErr(h.Log, "create code", err)
		writeError(h.Log, w, serverErr())
		return
	}
	if !attachCreatedCodeAssoc(&attachCodeAssocArgs{
		r: r, h: h, w: w, ownerID: ownerID, codeID: code.ID, req: req,
	}) {
		return
	}
	writeCreatedCode(h.Log, w, &code, req.SkillIDs, req.MCPServerIDs)
}

// attachCodeAssocArgs —— attachCreatedCodeAssoc 入参打包；revive
// argument-limit ≤ 5。字段按 govet fieldalignment 排：interface 16B
// 类先 (w), 然后 8B 指针, string headers, etc。
type attachCodeAssocArgs struct {
	w       http.ResponseWriter
	r       *http.Request
	h       *Handlers
	req     *createCodeRequest
	ownerID string
	codeID  string
}

// attachCreatedCodeAssoc —— 顺序绑 skill_ids + mcp_server_ids。任一失败
// 直接写 envelope 返 false；成功返 true。
func attachCreatedCodeAssoc(a *attachCodeAssocArgs) bool {
	if aerr := attachCreatedCodeSkills(a.r, a.h, a.ownerID, a.codeID, a.req.SkillIDs); aerr != nil {
		handleSetCodeSkillsErr(a.h.Log, a.w, aerr)
		return false
	}
	merr := attachCreatedCodeMCPServers(a.r, a.h, a.ownerID, a.codeID, a.req.MCPServerIDs)
	if merr != nil {
		handleSetCodeMCPServersErr(a.h.Log, a.w, merr)
		return false
	}
	return true
}

// attachCreatedCodeSkills —— createCode 时 attach skill_ids 到刚建好的 code。
// 失败时 caller 翻译 envelope（code 已 create，不回滚 —— PUT
// /codes/{id}/skills 之后还可以重试）。
func attachCreatedCodeSkills(
	r *http.Request, h *Handlers, ownerID, codeID string, skillIDs []string,
) error {
	if len(skillIDs) == 0 {
		return nil
	}
	return usecases.SetCodeSkills(r.Context(), h.SkillsAdmin.Skills, &usecases.SetCodeSkillsInput{
		OwnerID: ownerID, CodeID: codeID, SkillIDs: skillIDs,
	})
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
		MaxBookings:          req.MaxBookings,
		GrantedSkills:        req.GrantedSkills,
		AssumedRoleID:        req.AssumedRoleID,
	}
}

func writeCreatedCode(
	log *slog.Logger, w http.ResponseWriter, c *domain.AccessCode,
	skillIDs, serverIDs []string,
) {
	v := toCodeView(c)
	v.SkillIDs = skillIDs
	v.MCPServerIDs = serverIDs
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
