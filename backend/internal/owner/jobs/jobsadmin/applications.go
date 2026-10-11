// applications.go —— the owner's applications in the panel: the list, one application with its
// outcome timeline, and setting its outcome (the same use case as MCP applications.update_outcome).
//
// The rows carry resume_content: the "RESUME SENT · SNAPSHOT" block on the detail card answers
// "what did I actually send" (F-E-23), and the list's query already fetches it.

package jobsadmin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// applicationDetail —— one application with its outcome timeline, oldest first.
type applicationDetail struct {
	*jobsmodel.ApplicationRow

	Outcomes []jobsmodel.OutcomeRow `json:"outcomes"`
	// Questions —— what the recruiter asked, gaps marked (roadmap 2.1.c).
	Questions []jobsmodel.Exchange `json:"questions"`
}

func listApplications(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, perr := pageRequest(r)
		if perr != nil {
			writeJSONErr(deps.Log, w, badRequest("bad cursor"))
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		page, err := deps.Apps.ListPage(r.Context(), ownerID, r.URL.Query().Get("q"), req)
		if err != nil {
			deps.Log.Error("list applications", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, paging.Each(page, jobsmodel.RowOf))
	}
}

func getApplication(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID, id := authmw.OwnerIDFrom(r.Context()), chi.URLParam(r, "id")
		app, err := deps.Apps.GetByID(r.Context(), ownerID, id)
		if err != nil {
			writeAppErr(deps.Log, w, err)
			return
		}
		detail, err := detailOf(r.Context(), &deps, ownerID, &app)
		if err != nil {
			writeAppErr(deps.Log, w, err)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, detail)
	}
}

// detailOf —— the row, its outcome journal, and the recruiter's questions.
func detailOf(
	ctx context.Context, deps *Deps, ownerID string, app *jobsmodel.Application,
) (applicationDetail, error) {
	d, err := jobsuc.DetailOf(ctx, deps.Apps, ownerID, app)
	return applicationDetail{
		ApplicationRow: &d.Row, Outcomes: d.Outcomes, Questions: d.Questions,
	}, err
}

func setOutcome(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Outcome string `json:"outcome"`
			Note    string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSONErr(deps.Log, w, badRequest("invalid body"))
			return
		}
		res, err := jobsuc.UpdateOutcome(r.Context(), deps.Outcomes, &jobsuc.OutcomeChange{
			OwnerID: authmw.OwnerIDFrom(r.Context()), ApplicationID: chi.URLParam(r, "id"),
			To: body.Outcome, Note: body.Note,
		})
		if err != nil {
			writeAppErr(deps.Log, w, err)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, jobsmodel.RowOf(&res.Application))
	}
}

// writeAppErr —— an application's refusals in words the panel shows.
func writeAppErr(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, jobsmodel.ErrApplicationNotFound):
		writeJSONErr(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "not_found", Message: "application not found",
		})
	case errors.Is(err, jobsmodel.ErrUnknownOutcome):
		writeJSONErr(log, w, badRequest("outcome must be one of: none, responded, interview, "+
			"offer, rejected, hired, withdrawn"))
	default:
		log.Error("application", logErrKey, err)
		writeServerErr(log, w)
	}
}

func badRequest(msg string) apierr.Envelope {
	return apierr.Envelope{Status: http.StatusBadRequest, Code: "bad_request", Message: msg}
}
