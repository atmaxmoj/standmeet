// skills.go —— admin /skills endpoint：list / create / delete owner-curated
// AI skills（builtin 不可删）。同时为 codes 编辑提供 attach: PUT
// /api/admin/codes/{id}/skills 接受 skill_id 列表，rep.SetCodeSkills 落 join 表。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// SkillsAdminDeps —— admin skills handlers 依赖。
type SkillsAdminDeps struct {
	Skills usecases.SkillsDeps
}

type skillView struct {
	CreatedAt    string   `json:"created_at"`
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Prompt       string   `json:"prompt"`
	Source       string   `json:"source"`
	AllowedTools []string `json:"allowed_tools"`
	IsBuiltin    bool     `json:"is_builtin"`
	Enabled      bool     `json:"enabled"`
}

type createSkillRequest struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Prompt       string   `json:"prompt"`
	AllowedTools []string `json:"allowed_tools"`
}

// MountSkills 挂 /skills。owner-curated skill 池 CRUD；attach to code 在
// A.3-IAM-5 删了，skill 通过 role_skills 挂 role。
func (h *Handlers) MountSkills(r chi.Router) {
	r.Route("/skills", func(r chi.Router) {
		r.Get("/", h.listSkills())
		r.Post("/", h.createSkill())
		r.Patch("/{id}", h.patchSkill())
		r.Delete("/{id}", h.deleteSkill())
	})
}

type patchSkillRequest struct {
	Enabled bool `json:"enabled"`
}

// patchSkill —— #48-2: 全局开/关一个 skill。
func (h *Handlers) patchSkill() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req patchSkillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		skillID := chi.URLParam(r, "id")
		skill, err := usecases.SetSkillEnabled(
			r.Context(), h.SkillsAdmin.Skills, ownerID, skillID, req.Enabled,
		)
		if err != nil {
			handlePatchSkillErr(h.Log, w, err)
			return
		}
		writeSkillSingle(h.Log, w, &skill)
	}
}

func writeSkillSingle(log *slog.Logger, w http.ResponseWriter, s *domain.Skill) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(toSkillView(s)); err != nil {
		logEncodeErr(log, "encode skill", err)
	}
}

func handlePatchSkillErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("skill id required"))
	case errors.Is(err, domain.ErrSkillNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "skill_not_found",
			Message: "skill not found",
		})
	default:
		logEncodeErr(log, "patch skill", err)
		writeError(log, w, serverErr())
	}
}

func (h *Handlers) listSkills() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := usecases.ListSkills(r.Context(), h.SkillsAdmin.Skills, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list skills", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeSkillsList(h.Log, w, rows)
	}
}

func writeSkillsList(log *slog.Logger, w http.ResponseWriter, rows []domain.Skill) {
	items := make([]skillView, 0, len(rows))
	for i := range rows {
		items = append(items, toSkillView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(log, "encode skills", err)
	}
}

func toSkillView(s *domain.Skill) skillView {
	tools := s.AllowedTools
	if tools == nil {
		tools = []string{}
	}
	return skillView{
		ID: s.ID, Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		Source: s.Source, IsBuiltin: s.IsBuiltin, Enabled: s.Enabled,
		AllowedTools: tools,
		CreatedAt:    s.CreatedAt.Format(time.RFC3339),
	}
}

func (h *Handlers) createSkill() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createSkillRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		in := &usecases.CreateSkillInput{
			OwnerID: ownerID, Name: req.Name, Description: req.Description, Prompt: req.Prompt,
			AllowedTools: req.AllowedTools,
		}
		skill, err := usecases.CreateSkill(r.Context(), h.SkillsAdmin.Skills, in)
		if err != nil {
			handleCreateSkillErr(h.Log, w, err)
			return
		}
		writeCreatedSkill(h.Log, w, &skill)
	}
}

func handleCreateSkillErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, usecases.ErrEmptyField):
		writeError(log, w, envBadReq("name and prompt are required"))
	case errors.Is(err, domain.ErrSkillNameTaken):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusConflict, Code: "skill_name_taken",
			Message: "skill name already taken",
		})
	default:
		logEncodeErr(log, "create skill", err)
		writeError(log, w, serverErr())
	}
}

func writeCreatedSkill(log *slog.Logger, w http.ResponseWriter, s *domain.Skill) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(toSkillView(s)); err != nil {
		logEncodeErr(log, "encode skill", err)
	}
}

func (h *Handlers) deleteSkill() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		skillID := chi.URLParam(r, "id")
		err := usecases.DeleteSkill(r.Context(), h.SkillsAdmin.Skills, ownerID, skillID)
		if err != nil {
			handleDeleteSkillErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteSkillErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrSkillBuiltinImmutable):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusForbidden, Code: "skill_builtin_immutable",
			Message: "builtin skill cannot be deleted",
		})
	case errors.Is(err, domain.ErrSkillNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "skill_not_found",
			Message: "skill not found",
		})
	default:
		logEncodeErr(log, "delete skill", err)
		writeError(log, w, serverErr())
	}
}

// setCodeSkills handler + handleSetCodeSkillsErr 在 A.3-IAM-5 删 ——
// skills 通过 role_skills 挂 role，code 不再直接持 skill_ids。
