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

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// SkillsAdminDeps —— admin skills handlers 依赖。
type SkillsAdminDeps struct {
	Skills usecases.SkillsDeps
}

type skillView struct {
	CreatedAt   string `json:"created_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
	Source      string `json:"source"`
	IsBuiltin   bool   `json:"is_builtin"`
}

type createSkillRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Prompt      string `json:"prompt"`
}

type setCodeSkillsRequest struct {
	SkillIDs []string `json:"skill_ids"`
}

// MountSkills 挂 /skills + /codes/{id}/skills。MountSkills 由 MountAuthed
// 调用，外层已经裹了 owner session。
func (h *Handlers) MountSkills(r chi.Router) {
	r.Route("/skills", func(r chi.Router) {
		r.Get("/", h.listSkills())
		r.Post("/", h.createSkill())
		r.Delete("/{id}", h.deleteSkill())
	})
	r.Put("/codes/{id}/skills", h.setCodeSkills())
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
	return skillView{
		ID: s.ID, Name: s.Name, Description: s.Description, Prompt: s.Prompt,
		Source: s.Source, IsBuiltin: s.IsBuiltin,
		CreatedAt: s.CreatedAt.Format(time.RFC3339),
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

func (h *Handlers) setCodeSkills() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req setCodeSkillsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		codeID := chi.URLParam(r, "id")
		in := &usecases.SetCodeSkillsInput{
			OwnerID: ownerID, CodeID: codeID, SkillIDs: req.SkillIDs,
		}
		if err := usecases.SetCodeSkills(r.Context(), h.SkillsAdmin.Skills, in); err != nil {
			handleSetCodeSkillsErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleSetCodeSkillsErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrCodeInvalid):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "code_not_found", Message: "code not found",
		})
	case errors.Is(err, domain.ErrSkillNotFound):
		writeError(log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "skill_not_found",
			Message: "one or more skill ids do not exist",
		})
	default:
		logEncodeErr(log, "set code skills", err)
		writeError(log, w, serverErr())
	}
}
