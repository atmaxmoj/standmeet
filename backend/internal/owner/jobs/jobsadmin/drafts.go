// drafts.go — GET /api/admin/drafts (list + single-draft detail).
//
// Split out of routes.go to stay under the 350-line cap; route mounting
// still lives in Mount, this file only has the view shapes and handlers for
// the drafts family.
//
// Both views carry `resume_content`, and it's **the same domain shape
// passed through directly**: the list one feeds the card thumbnail, the
// detail one feeds the composer. Previously only the detail view carried
// content, so the card rendered a hard-coded fake resume (F-E-20) — one
// surface could see the real thing and the other couldn't, so the two drew
// different pictures.

package jobsadmin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// draftView — a single draft in the list. **Carries resume_content**: the
// card thumbnail renders exactly this, and it used to render a design-time
// fake resume (claiming, under the owner's real name, a Stanford PhD and a
// stint at Google Brain — two different drafts rendered the same picture,
// F-E-20). The content was already in the row ListByOwner fetches; this
// just stops discarding it.
type draftView struct {
	UpdatedAt time.Time `json:"updated_at"`
	// ExpiresAt — the 1-day TTL's end; the row's "N hours left" chip reads it.
	ExpiresAt time.Time `json:"expires_at"`
	ID        string    `json:"id"`
	Company   string    `json:"company"`
	Role      string    `json:"role"`
	ForJob    string    `json:"for_job"`
	Template  string    `json:"template"`
	// BasedOnMasterID / Name — the master this draft started from (omitted = none).
	BasedOnMasterID   string                  `json:"based_on_master_id,omitempty"`
	BasedOnMasterName string                  `json:"based_on_master_name,omitempty"`
	ResumeContent     jobsmodel.ResumeContent `json:"resume_content"`
}

func newDraftView(d *jobsmodel.ResumeDraft) draftView {
	return draftView{
		ID: d.ID, Company: d.JobSnapshot.Company, Role: d.JobSnapshot.Title, ForJob: d.JobCacheID,
		UpdatedAt: d.CreatedAt, ExpiresAt: d.ExpiresAt, Template: d.Template,
		BasedOnMasterID: d.BasedOnMasterID, BasedOnMasterName: d.BasedOnMasterName,
		ResumeContent: d.ResumeContent,
	}
}

// listDrafts — one page of the owner's drafts (docs/design/paging.md: {items, next_cursor, total}).
func listDrafts(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		req, perr := pageRequest(r)
		if perr != nil {
			writeBadCursor(deps.Log, w)
			return
		}
		page, err := deps.Resume.Drafts.ListPage(r.Context(), ownerID, req)
		if err != nil {
			deps.Log.Error("list drafts", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, paging.Each(page, newDraftView))
	}
}

// createDraftReq — the panel's "new draft" form. Only company is required;
// role/URL/JD are optional context. master_id = the master to start from;
// blank = an empty résumé even when a default master exists; neither = the default.
type createDraftReq struct {
	Company  string `json:"company"`
	Role     string `json:"role"`
	JobURL   string `json:"job_url"`
	JobText  string `json:"job_text"`
	MasterID string `json:"master_id"`
	Blank    bool   `json:"blank"`
}

func createDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		var req createDraftReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONErr(deps.Log, w, apierr.Envelope{
				Status: http.StatusBadRequest, Code: "bad_request", Message: "invalid body",
			})
			return
		}
		out, err := jobsuc.CreateManualDraft(
			r.Context(), *deps.Resume, ownerID,
			&jobsuc.ManualDraftInput{
				Company: req.Company, Role: req.Role, JobURL: req.JobURL, JobText: req.JobText,
				MasterID: req.MasterID, Blank: req.Blank,
			},
		)
		if err != nil {
			handleCreateDraftErr(deps.Log, w, err)
			return
		}
		writeCreatedDraft(deps.Log, w, &out.Draft)
	}
}

func handleCreateDraftErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, apierr.ErrEmptyField) {
		writeJSONErr(log, w, apierr.Envelope{
			Status: http.StatusBadRequest, Code: "bad_request", Message: "company is required",
		})
		return
	}
	if errors.Is(err, jobsmodel.ErrResumeMasterNotFound) {
		writeMasterNotFound(log, w)
		return
	}
	log.Error("create manual draft", logErrKey, err)
	writeServerErr(log, w)
}

func writeCreatedDraft(
	log *slog.Logger, w http.ResponseWriter, draft *jobsmodel.ResumeDraft,
) {
	writeJSON(log, w, http.StatusCreated, newDraftView(draft))
}

// draftDetailView — #52: the composer fetches the real resume_content
// (+ job context) on open.
type draftDetailView struct {
	ExpiresAt time.Time `json:"expires_at"`
	ID        string    `json:"id"`
	Company   string    `json:"company"`
	Role      string    `json:"role"`
	Template  string    `json:"template"`
	// BasedOnMasterID / Name — the master this draft started from (omitted = none); the composer's
	// "set as master" offers to overwrite it.
	BasedOnMasterID   string `json:"based_on_master_id,omitempty"`
	BasedOnMasterName string `json:"based_on_master_name,omitempty"`
	// PuckData — the Puck editor state to restore on open (omitted when the draft has none yet;
	// the editor then derives it from resume_content). Passed through verbatim.
	PuckData      json.RawMessage         `json:"puck_data,omitempty"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

// newDraftDetailView — the shape the composer loads (and the PATCH save echoes back).
func newDraftDetailView(draft *jobsmodel.ResumeDraft) draftDetailView {
	return draftDetailView{
		ID: draft.ID, Company: draft.JobSnapshot.Company,
		Role: draft.JobSnapshot.Title, Template: draft.Template, ExpiresAt: draft.ExpiresAt,
		BasedOnMasterID: draft.BasedOnMasterID, BasedOnMasterName: draft.BasedOnMasterName,
		ResumeContent: draft.ResumeContent,
		PuckData:      draft.PuckData,
	}
}

func getDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		draft, err := deps.Resume.Drafts.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		w.Header().Set(ctHeader, ctJSON)
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(newDraftDetailView(&draft)); eerr != nil {
			deps.Log.Error("encode draft detail", logErrKey, eerr)
		}
	}
}

// discardDraft — DELETE /drafts/{id}. The owner throws a draft away from the list. Calls the SAME
// idempotent usecase as MCP resume.discard_draft, so the two paths can't diverge. 204 on success.
func discardDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		if err := jobsuc.DiscardResumeDraft(
			r.Context(), *deps.Resume, ownerID, chi.URLParam(r, "id"),
		); err != nil {
			deps.Log.Error("discard draft", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDraftDetailErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, jobsmodel.ErrResumeDraftNotFound) {
		writeJSONErr(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "draft_not_found", Message: "draft not found",
		})
		return
	}
	log.Error("get draft", logErrKey, err)
	writeServerErr(log, w)
}

// jsonBody —— the bodies the drafts and masters routes answer with.
type jsonBody interface {
	draftView | paging.Page[draftView] |
		*jobsmodel.ResumeMaster | paging.Page[jobsmodel.ResumeMaster]
}

// writeJSON — one encoded response body with its status.
func writeJSON[T jsonBody](log *slog.Logger, w http.ResponseWriter, status int, v T) {
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("encode response", logErrKey, err)
	}
}

func writeBadCursor(log *slog.Logger, w http.ResponseWriter) {
	writeJSONErr(log, w, apierr.Envelope{
		Status: http.StatusBadRequest, Code: "bad_request", Message: "bad cursor",
	})
}
