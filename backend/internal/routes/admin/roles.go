// roles.go —— admin /roles endpoint：list / create / get / update /
// delete owner-curated visitor 身份原型。vanilla (is_builtin=true) 可改
// prompt / corpus URIs / skills / mcp / description，不可改 name / 不可删。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// RolesAdminDeps —— admin roles handlers 依赖。
type RolesAdminDeps struct {
	Roles usecases.RolesDeps
}

type roleView struct {
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
	PromptID     *string  `json:"prompt_id,omitempty"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
	ActiveCodes  int64    `json:"active_codes"`
	IsBuiltin    bool     `json:"is_builtin"`
}

type writeRoleRequest struct {
	PromptID     *string  `json:"prompt_id,omitempty"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
}

// MountRoles 挂 /roles 子路由。
func (h *Handlers) MountRoles(r chi.Router) {
	r.Route("/roles", func(r chi.Router) {
		r.Get("/", h.listRoles())
		r.Post("/", h.createRole())
		r.Get("/{id}", h.getRole())
		r.Put("/{id}", h.updateRole())
		r.Delete("/{id}", h.deleteRole())
	})
}

func (h *Handlers) listRoles() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := usecases.ListRoles(r.Context(), h.RolesAdmin.Roles, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list roles", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeRolesList(r, h, w, rows)
	}
}

func writeRolesList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []domain.Role,
) {
	items := assembleRoleViews(r, h, rows)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode roles", err)
	}
}

func assembleRoleViews(r *http.Request, h *Handlers, rows []domain.Role) []roleView {
	items := make([]roleView, 0, len(rows))
	for i := range rows {
		items = append(items, hydrateRoleView(r, h, &rows[i]))
	}
	return items
}

// hydrateRoleView —— 一条 role 的活跃 code 计数 + roleView 装配。提出来降
// writeRolesList 的 cyclo。
func hydrateRoleView(r *http.Request, h *Handlers, rl *domain.Role) roleView {
	count, cerr := usecases.CountActiveCodesForRole(
		r.Context(), h.RolesAdmin.Roles, rl.OwnerID(), rl.ID(),
	)
	if cerr != nil {
		h.Log.Error("count active codes for role", "role_id", rl.ID(), "err", cerr)
		count = 0
	}
	return toRoleView(rl, count)
}

func toRoleView(rl *domain.Role, activeCodes int64) roleView {
	v := roleView{
		ID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		CorpusURIs: rl.CorpusURIs(), SkillIDs: rl.SkillIDs(),
		MCPServerIDs: rl.MCPServerIDs(),
		IsBuiltin:    rl.IsBuiltin(),
		ActiveCodes:  activeCodes,
		CreatedAt:    rl.CreatedAt().UTC().Format(time.RFC3339),
		UpdatedAt:    rl.UpdatedAt().UTC().Format(time.RFC3339),
	}
	if pid, ok := rl.PromptID(); ok {
		v.PromptID = &pid
	}
	return v
}

func (h *Handlers) createRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req writeRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		role, err := usecases.CreateRole(r.Context(), h.RolesAdmin.Roles, &usecases.RoleWriteInput{
			OwnerID: ownerID, Name: req.Name, Description: req.Description, PromptID: req.PromptID,
			CorpusURIs: req.CorpusURIs, SkillIDs: req.SkillIDs, MCPServerIDs: req.MCPServerIDs,
		})
		if err != nil {
			handleWriteRoleErr(h.Log, w, err, "create")
			return
		}
		writeOneRole(r, h, w, &role, http.StatusCreated)
	}
}

func (h *Handlers) getRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		roleID := chi.URLParam(r, "id")
		role, err := usecases.GetRole(r.Context(), h.RolesAdmin.Roles, ownerID, roleID)
		if err != nil {
			handleGetRoleErr(h.Log, w, err)
			return
		}
		writeOneRole(r, h, w, &role, http.StatusOK)
	}
}

var getRoleErrCases = []apierr.Case{
	{
		Match: domain.ErrRoleNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "role_not_found", Message: "role not found",
		},
	},
}

func handleGetRoleErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, getRoleErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "get role", err)
	}
	writeError(log, w, env)
}

func (h *Handlers) updateRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req writeRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		roleID := chi.URLParam(r, "id")
		role, err := usecases.UpdateRole(r.Context(), h.RolesAdmin.Roles, &usecases.RoleWriteInput{
			OwnerID: ownerID, RoleID: roleID, Name: req.Name, Description: req.Description,
			PromptID: req.PromptID, CorpusURIs: req.CorpusURIs,
			SkillIDs: req.SkillIDs, MCPServerIDs: req.MCPServerIDs,
		})
		if err != nil {
			handleWriteRoleErr(h.Log, w, err, "update")
			return
		}
		writeOneRole(r, h, w, &role, http.StatusOK)
	}
}

func (h *Handlers) deleteRole() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		roleID := chi.URLParam(r, "id")
		err := usecases.DeleteRole(r.Context(), h.RolesAdmin.Roles, ownerID, roleID)
		if err != nil {
			handleDeleteRoleErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// writeRoleErrCases —— Create + Update 共用 error → envelope 翻译表。
var writeRoleErrCases = []apierr.Case{
	{Match: usecases.ErrEmptyField, Envelope: envBadReq("name is required")},
	{
		Match: domain.ErrRoleNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "role_not_found", Message: "role not found",
		},
	},
	{
		Match: domain.ErrRoleBuiltinImmutable,
		Envelope: apierr.Envelope{
			Status: http.StatusForbidden, Code: "role_builtin_immutable",
			Message: "builtin role cannot be renamed",
		},
	},
	{
		Match: domain.ErrRoleNameTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "role_name_taken",
			Message: "role name already taken",
		},
	},
	{Match: domain.ErrPromptNotFound, Envelope: envBadReq("prompt id not found for this owner")},
	{Match: domain.ErrSkillNotFound, Envelope: envBadReq("one or more skill ids not found")},
	{
		Match:    domain.ErrMCPServerNotFound,
		Envelope: envBadReq("one or more mcp server ids not found"),
	},
}

// handleWriteRoleErr —— Create + Update 共用错误翻译。
func handleWriteRoleErr(log *slog.Logger, w http.ResponseWriter, err error, tag string) {
	env := apierr.Classify(err, writeRoleErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, tag+" role", err)
	}
	writeError(log, w, env)
}

var deleteRoleErrCases = []apierr.Case{
	{
		Match: domain.ErrRoleBuiltinImmutable,
		Envelope: apierr.Envelope{
			Status: http.StatusForbidden, Code: "role_builtin_immutable",
			Message: "builtin role cannot be deleted",
		},
	},
	{
		Match: domain.ErrRoleNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "role_not_found", Message: "role not found",
		},
	},
}

func handleDeleteRoleErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, deleteRoleErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "delete role", err)
	}
	writeError(log, w, env)
}

func writeOneRole(
	r *http.Request, h *Handlers, w http.ResponseWriter, rl *domain.Role, status int,
) {
	count, cerr := usecases.CountActiveCodesForRole(
		r.Context(), h.RolesAdmin.Roles, rl.OwnerID(), rl.ID(),
	)
	if cerr != nil {
		h.Log.Error("count active codes for role",
			"role_id", rl.ID(), "err", cerr,
		)
		count = 0
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(toRoleView(rl, count)); err != nil {
		logEncodeErr(h.Log, "encode role", err)
	}
}
