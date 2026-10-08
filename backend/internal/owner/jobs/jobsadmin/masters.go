// masters.go — /api/admin/masters: the résumé masters (docs/design/resume-masters.md), plus
// POST /drafts/{id}/save-as-master. Every handler calls the same jobsuc usecase as the MCP
// resume.master_* tools, and encodes jobsmodel.ResumeMaster as-is (one wire shape on both faces).

package jobsadmin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

type createMasterReq struct {
	Content   *jobsmodel.ResumeContent `json:"resume_content"`
	Name      string                   `json:"name"`
	DraftID   string                   `json:"draft_id"`
	IsDefault bool                     `json:"is_default"`
}

type patchMasterReq struct {
	Name      *string                  `json:"name"`
	Content   *jobsmodel.ResumeContent `json:"resume_content"`
	IsDefault *bool                    `json:"is_default"`
}

type saveAsMasterReq struct {
	MasterID    string `json:"master_id"`
	Name        string `json:"name"`
	MakeDefault bool   `json:"make_default"`
}

func listMasters(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, perr := pageRequest(r)
		if perr != nil {
			writeBadCursor(deps.Log, w)
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		page, err := jobsuc.ListMasters(r.Context(), deps.Resume, ownerID, req)
		if err != nil {
			writeMasterErr(deps.Log, w, err)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, page)
	}
}

func getMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		m, err := jobsuc.GetMaster(r.Context(), deps.Resume, ownerID, chi.URLParam(r, "id"))
		writeMaster(deps.Log, w, http.StatusOK, &m, err)
	}
}

func createMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createMasterReq
		if !decodeBody(deps.Log, w, r, &req) {
			return
		}
		m, err := jobsuc.CreateMaster(r.Context(), deps.Resume, &jobsuc.CreateMasterInput{
			OwnerID: authmw.OwnerIDFrom(r.Context()), Name: req.Name, Content: req.Content,
			DraftID: req.DraftID, IsDefault: req.IsDefault,
		})
		writeMaster(deps.Log, w, http.StatusCreated, &m, err)
	}
}

func patchMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req patchMasterReq
		if !decodeBody(deps.Log, w, r, &req) {
			return
		}
		m, err := jobsuc.UpdateMaster(r.Context(), deps.Resume, &jobsuc.UpdateMasterInput{
			OwnerID: authmw.OwnerIDFrom(r.Context()), MasterID: chi.URLParam(r, "id"),
			Name: req.Name, Content: req.Content, IsDefault: req.IsDefault,
		})
		writeMaster(deps.Log, w, http.StatusOK, &m, err)
	}
}

func deleteMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := jobsuc.DeleteMaster(
			r.Context(), deps.Resume, authmw.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		); err != nil {
			writeMasterErr(deps.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func saveDraftAsMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req saveAsMasterReq
		if !decodeBody(deps.Log, w, r, &req) {
			return
		}
		m, err := jobsuc.SaveDraftAsMaster(r.Context(), deps.Resume, &jobsuc.SaveAsMasterInput{
			OwnerID: authmw.OwnerIDFrom(r.Context()), DraftID: chi.URLParam(r, "id"),
			MasterID: req.MasterID, Name: req.Name, MakeDefault: req.MakeDefault,
		})
		writeMaster(deps.Log, w, http.StatusOK, &m, err)
	}
}

// previewMaster — the master's PDF through the same print route a draft's preview uses. A master
// has no code, so the QR is the non-leaking placeholder.
func previewMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		m, err := jobsuc.GetMaster(r.Context(), deps.Resume, ownerID, chi.URLParam(r, "id"))
		if err != nil {
			writeMasterErr(deps.Log, w, err)
			return
		}
		app := jobsmodel.Application{ID: m.ID, ResumeContent: m.ResumeContent}
		writePreviewPDF(deps, w, r, &app, previewQRURL)
	}
}

func decodeBody[T createMasterReq | patchMasterReq | saveAsMasterReq](
	log *slog.Logger, w http.ResponseWriter, r *http.Request, v *T,
) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeJSONErr(log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "bad_request", Message: "invalid body",
		})
		return false
	}
	return true
}

func writeMaster(
	log *slog.Logger, w http.ResponseWriter, status int, m *jobsmodel.ResumeMaster, err error,
) {
	if err != nil {
		writeMasterErr(log, w, err)
		return
	}
	writeJSON(log, w, status, m)
}

func trashedMasters(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner := authmw.OwnerIDFrom(r.Context())
		items, err := jobsuc.TrashedMasters(r.Context(), deps.Resume, owner)
		if err != nil {
			writeMasterErr(deps.Log, w, err)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, map[string][]jobsmodel.TrashedMaster{"items": items})
	}
}

func restoreMaster(deps *Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := jobsuc.RestoreMaster(
			r.Context(), deps.Resume, authmw.OwnerIDFrom(r.Context()), chi.URLParam(r, "id"),
		); err != nil {
			writeMasterErr(deps.Log, w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func writeMasterNotFound(log *slog.Logger, w http.ResponseWriter) {
	writeJSONErr(log, w, apierr.Envelope{
		Status: http.StatusNotFound, Code: "master_not_found", Message: "master not found",
	})
}

// masterRefusals —— the master errors the caller can act on, and the envelope each answers with.
var masterRefusals = []struct {
	err error
	env apierr.Envelope
}{
	{jobsmodel.ErrResumeMasterNotFound, apierr.Envelope{
		Status: http.StatusNotFound, Code: "master_not_found", Message: "master not found",
	}},
	{jobsmodel.ErrResumeMasterNotInTrash, apierr.Envelope{
		Status: http.StatusNotFound, Code: "not_in_trash",
		Message: "this master is not in the trash",
	}},
	{jobsmodel.ErrResumeMasterNameRequired, apierr.Envelope{
		Status: http.StatusBadRequest, Code: "bad_request", Message: "name is required",
	}},
}

func writeMasterErr(log *slog.Logger, w http.ResponseWriter, err error) {
	for _, r := range masterRefusals {
		if errors.Is(err, r.err) {
			writeJSONErr(log, w, r.env)
			return
		}
	}
	if errors.Is(err, jobsmodel.ErrResumeDraftNotFound) {
		handleDraftDetailErr(log, w, err)
		return
	}
	log.Error("resume master", logErrKey, err)
	writeServerErr(log, w)
}
