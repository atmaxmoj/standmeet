// drafts_edit.go — the composer's write + preview surface (split from drafts.go for the 350-line
// cap):
//   - PATCH /drafts/{id}         — persist edited resume_content + the chosen Typst template, so
//     the composer stops discarding what the owner types (before this only create + commit existed,
//     and everything typed in the composer was thrown away at send).
//   - GET   /drafts/templates    — the Typst layouts the owner may pick (classic / compact / …).
//   - GET   /drafts/{id}/preview.pdf — the REAL Typst render (placeholder QR) the preview shows,
//     so what the owner sees is what commit will send.

package jobsadmin

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// previewQRURL — the placeholder the preview render encodes. The real per-application code URL is
// only stamped at commit; the preview must not leak a live code, so it carries this fixed marker
// (the frontend's client mock used the same string).
const previewQRURL = "preview://standmeet/draft"

type patchDraftReq struct {
	Template      string                  `json:"template"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

func patchDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		var req patchDraftReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONErr(deps.Log, w, apierr.Envelope{
				Status: http.StatusBadRequest, Code: "bad_request", Message: "invalid body",
			})
			return
		}
		out, err := jobsuc.SaveResumeDraft(
			r.Context(), jobsuc.ResumeDeps{Drafts: deps.Drafts}, jobsuc.SaveDraftInput{
				OwnerID: ownerID, DraftID: chi.URLParam(r, "id"),
				Content: &req.ResumeContent, Template: req.Template,
			},
		)
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		w.Header().Set(ctHeader, ctJSON)
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(newDraftDetailView(&out.Draft)); eerr != nil {
			deps.Log.Error("encode saved draft", logErrKey, eerr)
		}
	}
}

func listTemplates(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		tpls := deps.Templates
		if tpls == nil {
			tpls = []string{}
		}
		w.Header().Set(ctHeader, ctJSON)
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(tpls); err != nil {
			deps.Log.Error("encode templates", logErrKey, err)
		}
	}
}

func previewDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		draft, err := deps.Drafts.GetByID(r.Context(), ownerID, chi.URLParam(r, "id"))
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		app := jobsmodel.Application{
			ResumeContent: draft.ResumeContent,
			Template:      draft.Template,
			JobSnapshot:   draft.JobSnapshot,
		}
		pdf, rerr := deps.Commit.Renderer.RenderApplicationPDF(r.Context(), &app, previewQRURL)
		if rerr != nil {
			deps.Log.Error("render draft preview", logErrKey, rerr)
			writeServerErr(deps.Log, w)
			return
		}
		w.Header().Set(ctHeader, "application/pdf")
		w.Header().Set("Cache-Control", "no-store")
		if _, werr := w.Write(pdf); werr != nil {
			deps.Log.Error("write preview pdf", logErrKey, werr)
		}
	}
}
