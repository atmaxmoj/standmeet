// commit.go — POST /api/admin/drafts/{id}/commit: where the panel's `SEND →`
// button lands.
//
// Why this route exists (F-E-9): the composer's SEND opens a confirmation
// dialog promising, item by item, "freeze snapshot / render a PDF with QR /
// write an application row / auto-issue a 180-day code", while `onSend` was
// wired to `onClose` — no request goes out, and nothing errors. The owner
// would believe they'd applied.
//
// Calls the **same** usecase (`jobsuc.CommitApplication`), sharing the same
// deps with the `applications.commit` path: the two surfaces therefore
// cannot diverge on what happens for the same commit.

package jobsadmin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

func commitDraft(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		committed, err := jobsuc.CommitApplication(
			r.Context(), deps.Commit, ownerID, chi.URLParam(r, "id"),
		)
		if err != nil {
			handleDraftDetailErr(deps.Log, w, err)
			return
		}
		writeCommitted(deps.Log, w, &committed)
	}
}

// committedView — **carries no PDF**: on the MCP path the PDF goes to the
// owner's AI as an embedded resource (it needs it to apply), while on this
// panel path what the owner needs to know is "did it succeed, what's the
// code, where does the QR point".
//
// **Correction**: this used to say "that PDF is archived on the application
// row, the list page can fetch it itself" — **that was false, and I wrote it
// down without verifying it**. The `applications` table has no PDF column,
// and nowhere in `jobsuc` does the rendered output get persisted; those
// bytes appear exactly once, in commit's response. The panel's
// `DOWNLOAD PDF` isn't a forgotten wire-up, then — there's nothing behind it
// to wire to (F-E-13). Making the panel downloadable requires first deciding
// whether to store the bytes or re-render on demand — that's a product
// decision.
type committedView struct {
	ApplicationID string `json:"application_id"`
	AccessCode    string `json:"access_code"`
	QRURL         string `json:"qr_url"`
}

func writeCommitted(
	log *slog.Logger, w http.ResponseWriter, c *jobsmodel.CommittedApplication,
) {
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	view := committedView{
		ApplicationID: c.Application.ID, AccessCode: c.AccessCode.Code, QRURL: c.QRURL,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode committed application", logErrKey, err)
	}
}
