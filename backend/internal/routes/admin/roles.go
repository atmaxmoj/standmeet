// roles.go —— admin /roles endpoint：list / create / get / update /
// delete owner-curated visitor 身份原型。public (is_builtin=true) 可改
// prompt / corpus URIs / skills / mcp / description，不可改 name / 不可删。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// RolesAdminDeps —— admin roles handlers 依赖。
type RolesAdminDeps struct {
	Roles access.RolesDeps
}

type roleView struct {
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
	PromptID     *string  `json:"prompt_id,omitempty"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Greeting     string   `json:"greeting"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
	// Waypoints —— ghost-steering 引导目的地（owner per-role 编辑，读回展示）。
	Waypoints []access.Waypoint `json:"waypoints"`
	// DockButtons —— #109/#110 ≤2 个 chat dock 按钮 [{capability_id, trigger}]。
	DockButtons []access.DockButtonConfig `json:"dock_buttons"`
	ActiveCodes int64                     `json:"active_codes"`
	IsBuiltin   bool                      `json:"is_builtin"`
	// NotifyOwnerOnBooking —— #130 per-role 通知开关(owner 看/设)。
	NotifyOwnerOnBooking bool `json:"notify_owner_on_booking"`
	// RequireGhostEvidence —— F-A-10 per-role 开关(owner 看/设)。
	RequireGhostEvidence bool `json:"require_ghost_evidence"`
}

type writeRoleRequest struct {
	PromptID     *string  `json:"prompt_id,omitempty"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Greeting     string   `json:"greeting"`
	CorpusURIs   []string `json:"corpus_uris"`
	SkillIDs     []string `json:"skill_ids"`
	MCPServerIDs []string `json:"mcp_server_ids"`
	// Waypoints —— ghost-steering 引导目的地（owner per-role 写）。
	Waypoints []access.Waypoint `json:"waypoints"`
	// DockButtons —— #109/#110 ≤2 个 chat dock 按钮 [{capability_id, trigger}]。
	DockButtons []access.DockButtonConfig `json:"dock_buttons"`
	// NotifyOwnerOnBooking —— #130 per-role 通知开关。
	NotifyOwnerOnBooking bool `json:"notify_owner_on_booking"`
	// RequireGhostEvidence —— F-A-10 per-role 开关。
	RequireGhostEvidence bool `json:"require_ghost_evidence"`
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
		rows, err := access.ListRoles(r.Context(), h.RolesAdmin.Roles, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list roles", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeRolesList(r, h, w, rows)
	}
}

func writeRolesList(
	r *http.Request, h *Handlers, w http.ResponseWriter, rows []access.Role,
) {
	items := assembleRoleViews(r, h, rows)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(h.Log, "encode roles", err)
	}
}

func assembleRoleViews(r *http.Request, h *Handlers, rows []access.Role) []roleView {
	items := make([]roleView, 0, len(rows))
	for i := range rows {
		items = append(items, hydrateRoleView(r, h, &rows[i]))
	}
	return items
}

// hydrateRoleView —— 一条 role 的活跃 code 计数 + roleView 装配。提出来降
// writeRolesList 的 cyclo。
func hydrateRoleView(r *http.Request, h *Handlers, rl *access.Role) roleView {
	count, cerr := access.CountActiveCodesForRole(
		r.Context(), h.RolesAdmin.Roles, rl.OwnerID(), rl.ID(),
	)
	if cerr != nil {
		h.Log.Error("count active codes for role", "role_id", rl.ID(), "err", cerr)
		count = 0
	}
	return toRoleView(rl, count)
}

func toRoleView(rl *access.Role, activeCodes int64) roleView {
	v := roleView{
		ID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		Greeting:   rl.Greeting(),
		CorpusURIs: rl.CorpusURIs(), SkillIDs: rl.SkillIDs(),
		MCPServerIDs:         rl.MCPServerIDs(),
		Waypoints:            rl.Waypoints(),
		DockButtons:          rl.DockButtons(),
		IsBuiltin:            rl.IsBuiltin(),
		NotifyOwnerOnBooking: rl.NotifyOwnerOnBooking(),
		RequireGhostEvidence: rl.RequireGhostEvidence(),
		ActiveCodes:          activeCodes,
		CreatedAt:            rl.CreatedAt().UTC().Format(time.RFC3339),
		UpdatedAt:            rl.UpdatedAt().UTC().Format(time.RFC3339),
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
		role, err := access.CreateRole(r.Context(), h.RolesAdmin.Roles, &access.RoleWriteInput{
			OwnerID: ownerID, Name: req.Name, Description: req.Description,
			Greeting: req.Greeting, PromptID: req.PromptID,
			CorpusURIs: req.CorpusURIs, SkillIDs: req.SkillIDs, MCPServerIDs: req.MCPServerIDs,
			Waypoints:   req.Waypoints,
			DockButtons: req.DockButtons, ValidCapabilityIDs: h.dockCapIDs(),
			NotifyOwnerOnBooking: req.NotifyOwnerOnBooking,
			RequireGhostEvidence: req.RequireGhostEvidence,
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
		role, err := access.GetRole(r.Context(), h.RolesAdmin.Roles, ownerID, roleID)
		if err != nil {
			handleGetRoleErr(h.Log, w, err)
			return
		}
		writeOneRole(r, h, w, &role, http.StatusOK)
	}
}

var getRoleErrCases = []apierr.Case{
	{
		Match: access.ErrRoleNotFound,
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
		role, err := access.UpdateRole(r.Context(), h.RolesAdmin.Roles, &access.RoleWriteInput{
			OwnerID: ownerID, RoleID: roleID, Name: req.Name,
			Description: req.Description, Greeting: req.Greeting,
			PromptID: req.PromptID, CorpusURIs: req.CorpusURIs,
			SkillIDs: req.SkillIDs, MCPServerIDs: req.MCPServerIDs,
			Waypoints:   req.Waypoints,
			DockButtons: req.DockButtons, ValidCapabilityIDs: h.dockCapIDs(),
			NotifyOwnerOnBooking: req.NotifyOwnerOnBooking,
			RequireGhostEvidence: req.RequireGhostEvidence,
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
		err := access.DeleteRole(r.Context(), h.RolesAdmin.Roles, ownerID, roleID)
		if err != nil {
			handleDeleteRoleErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// writeRoleErrCases —— Create + Update 共用 error → envelope 翻译表。
var writeRoleErrCases = []apierr.Case{
	{Match: apierr.ErrEmptyField, Envelope: envBadReq("name is required")},
	{Match: access.ErrTooManyDockButtons, Envelope: envBadReq("at most two dock buttons")},
	{Match: access.ErrDockButtonEmptyTrigger, Envelope: envBadReq("dock button needs a trigger")},
	{Match: access.ErrUnknownDockCapability, Envelope: envBadReq("unknown dock capability")},
	{
		Match: access.ErrRoleNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "role_not_found", Message: "role not found",
		},
	},
	{
		Match: access.ErrRoleBuiltinImmutable,
		Envelope: apierr.Envelope{
			Status: http.StatusForbidden, Code: "role_builtin_immutable",
			Message: "builtin role cannot be renamed",
		},
	},
	{
		Match: access.ErrRoleNameTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "role_name_taken",
			Message: "role name already taken",
		},
	},
	{Match: owner.ErrPromptNotFound, Envelope: envBadReq("prompt id not found for this owner")},
	{Match: marketplace.ErrSkillNotFound, Envelope: envBadReq("one or more skill ids not found")},
	{
		Match:    marketplace.ErrMCPServerNotFound,
		Envelope: envBadReq("one or more mcp server ids not found"),
	},
}

// handleWriteRoleErr —— Create + Update 共用错误翻译。
// dockCapIDs —— dock 按钮可挂的能力 id 集（访客侧、非 owner-only）。
func (h *Handlers) dockCapIDs() []string {
	return h.CapabilitiesAdmin.Registry.VisitorCapabilityIDs()
}

func handleWriteRoleErr(log *slog.Logger, w http.ResponseWriter, err error, tag string) {
	env := apierr.Classify(err, writeRoleErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, tag+" role", err)
	}
	writeError(log, w, env)
}

var deleteRoleErrCases = []apierr.Case{
	{
		Match: access.ErrRoleBuiltinImmutable,
		Envelope: apierr.Envelope{
			Status: http.StatusForbidden, Code: "role_builtin_immutable",
			Message: "builtin role cannot be deleted",
		},
	},
	{
		Match: access.ErrRoleNotFound,
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
	r *http.Request, h *Handlers, w http.ResponseWriter, rl *access.Role, status int,
) {
	count, cerr := access.CountActiveCodesForRole(
		r.Context(), h.RolesAdmin.Roles, rl.OwnerID(), rl.ID(),
	)
	if cerr != nil {
		h.Log.Error(
			"count active codes for role",
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
