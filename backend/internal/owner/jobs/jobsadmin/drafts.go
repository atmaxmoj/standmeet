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
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// draftView — a single draft in the list. **Carries resume_content**: the
// card thumbnail renders exactly this, and it used to render a design-time
// fake resume (claiming, under the owner's real name, a Stanford PhD and a
// stint at Google Brain — two different drafts rendered the same picture,
// F-E-20). The content was already in the row ListByOwner fetches; this
// just stops discarding it.
type draftView struct {
	UpdatedAt     time.Time               `json:"updated_at"`
	ID            string                  `json:"id"`
	Company       string                  `json:"company"`
	Role          string                  `json:"role"`
	ForJob        string                  `json:"for_job"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

func listDrafts(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		drafts, err := deps.Drafts.ListByOwner(r.Context(), ownerID)
		if err != nil {
			deps.Log.Error("list drafts", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeDraftsList(deps.Log, w, drafts)
	}
}

// draftDetailView — #52: the composer fetches the real resume_content
// (+ job context) on open.
type draftDetailView struct {
	ID            string                  `json:"id"`
	Company       string                  `json:"company"`
	Role          string                  `json:"role"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

func getDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		draft, err := deps.Drafts.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		view := draftDetailView{
			ID: draft.ID, Company: draft.JobSnapshot.Company,
			Role: draft.JobSnapshot.Title, ResumeContent: draft.ResumeContent,
		}
		w.Header().Set(ctHeader, ctJSON)
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(view); eerr != nil {
			deps.Log.Error("encode draft detail", logErrKey, eerr)
		}
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

func writeDraftsList(
	log *slog.Logger, w http.ResponseWriter, drafts []jobsmodel.ResumeDraft,
) {
	items := make([]draftView, 0, len(drafts))
	for i := range drafts {
		items = append(items, draftView{
			ID:            drafts[i].ID,
			Company:       drafts[i].JobSnapshot.Company,
			Role:          drafts[i].JobSnapshot.Title,
			ForJob:        drafts[i].JobCacheID,
			UpdatedAt:     drafts[i].CreatedAt,
			ResumeContent: drafts[i].ResumeContent,
		})
	}
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode drafts", logErrKey, err)
	}
}
