// prompts.go —— admin /prompts endpoint：list / create / get / update /
// delete owner-curated persona library。public (is_builtin=true) 可以改
// body / description / corpus URIs，但不可改 name / 不可删（usecase 层拦）。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

// PromptsAdminDeps —— admin prompts handlers 依赖。
type PromptsAdminDeps struct {
	Prompts owner.PromptsDeps
}

type promptView struct {
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Body        string `json:"body"`
	IsBuiltin   bool   `json:"is_builtin"`
}

type writePromptRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Body        string `json:"body"`
}

// MountPrompts 挂 /prompts 子路由。MountAuthed 外层裹 owner session。
func (h *Handlers) MountPrompts(r chi.Router) {
	r.Route("/prompts", func(r chi.Router) {
		r.Get("/", h.listPrompts())
		r.Post("/", h.createPrompt())
		r.Get("/{id}", h.getPrompt())
		r.Put("/{id}", h.updatePrompt())
		r.Delete("/{id}", h.deletePrompt())
	})
}

func (h *Handlers) listPrompts() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := owner.ListPrompts(r.Context(), h.PromptsAdmin.Prompts, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list prompts", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writePromptsList(h.Log, w, rows)
	}
}

func writePromptsList(log *slog.Logger, w http.ResponseWriter, rows []owner.Prompt) {
	items := make([]promptView, 0, len(rows))
	for i := range rows {
		items = append(items, toPromptView(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		logEncodeErr(log, "encode prompts", err)
	}
}

func toPromptView(p *owner.Prompt) promptView {
	return promptView{
		ID: p.ID(), Name: p.Name(), Description: p.Description(),
		Body: p.Body(), IsBuiltin: p.IsBuiltin(),
		CreatedAt: p.CreatedAt().UTC().Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt().UTC().Format(time.RFC3339),
	}
}

func (h *Handlers) createPrompt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req writePromptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		prompt, err := owner.CreatePrompt(
			r.Context(), h.PromptsAdmin.Prompts, &owner.CreatePromptInputReq{
				OwnerID: ownerID, Name: req.Name,
				Description: req.Description, Body: req.Body,
			},
		)
		if err != nil {
			handleCreatePromptErr(h.Log, w, err)
			return
		}
		writeOnePrompt(h.Log, w, &prompt, http.StatusCreated)
	}
}

var createPromptErrCases = []apierr.Case{
	{Match: apierr.ErrEmptyField, Envelope: envBadReq("name is required")},
	{
		Match: owner.ErrPromptNameTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "prompt_name_taken",
			Message: "prompt name already taken",
		},
	},
}

func handleCreatePromptErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, createPromptErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "create prompt", err)
	}
	writeError(log, w, env)
}

func (h *Handlers) getPrompt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		promptID := chi.URLParam(r, "id")
		prompt, err := owner.GetPrompt(r.Context(), h.PromptsAdmin.Prompts, ownerID, promptID)
		if err != nil {
			handleGetPromptErr(h.Log, w, err)
			return
		}
		writeOnePrompt(h.Log, w, &prompt, http.StatusOK)
	}
}

var getPromptErrCases = []apierr.Case{
	{
		Match: owner.ErrPromptNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "prompt_not_found", Message: "prompt not found",
		},
	},
}

func handleGetPromptErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, getPromptErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "get prompt", err)
	}
	writeError(log, w, env)
}

func (h *Handlers) updatePrompt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req writePromptRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		ownerID := middleware.OwnerIDFrom(r.Context())
		promptID := chi.URLParam(r, "id")
		prompt, err := owner.UpdatePrompt(
			r.Context(), h.PromptsAdmin.Prompts, &owner.UpdatePromptInputReq{
				OwnerID: ownerID, PromptID: promptID,
				Name: req.Name, Description: req.Description, Body: req.Body,
			},
		)
		if err != nil {
			handleUpdatePromptErr(h.Log, w, err)
			return
		}
		writeOnePrompt(h.Log, w, &prompt, http.StatusOK)
	}
}

var updatePromptErrCases = []apierr.Case{
	{
		Match: owner.ErrPromptNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "prompt_not_found", Message: "prompt not found",
		},
	},
	{
		Match: owner.ErrPromptBuiltinImmutable,
		Envelope: apierr.Envelope{
			Status: http.StatusForbidden, Code: "prompt_builtin_immutable",
			Message: "builtin prompt cannot be renamed",
		},
	},
	{
		Match: owner.ErrPromptNameTaken,
		Envelope: apierr.Envelope{
			Status: http.StatusConflict, Code: "prompt_name_taken",
			Message: "prompt name already taken",
		},
	},
}

func handleUpdatePromptErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, updatePromptErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "update prompt", err)
	}
	writeError(log, w, env)
}

func (h *Handlers) deletePrompt() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		promptID := chi.URLParam(r, "id")
		err := owner.DeletePrompt(r.Context(), h.PromptsAdmin.Prompts, ownerID, promptID)
		if err != nil {
			handleDeletePromptErr(h.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

var deletePromptErrCases = []apierr.Case{
	{
		Match: owner.ErrPromptBuiltinImmutable,
		Envelope: apierr.Envelope{
			Status: http.StatusForbidden, Code: "prompt_builtin_immutable",
			Message: "builtin prompt cannot be deleted",
		},
	},
	{
		Match: owner.ErrPromptNotFound,
		Envelope: apierr.Envelope{
			Status: http.StatusNotFound, Code: "prompt_not_found", Message: "prompt not found",
		},
	},
}

func handleDeletePromptErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := apierr.Classify(err, deletePromptErrCases)
	if env.Status >= http.StatusInternalServerError {
		logEncodeErr(log, "delete prompt", err)
	}
	writeError(log, w, env)
}

func writeOnePrompt(log *slog.Logger, w http.ResponseWriter, p *owner.Prompt, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(toPromptView(p)); err != nil {
		logEncodeErr(log, "encode prompt", err)
	}
}
