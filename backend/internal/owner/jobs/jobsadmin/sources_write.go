// sources_write.go — the write side of the jobs admin surface: register a source,
// remove one, and fetch now.
//
// **Why this file exists**: registering a source and fetching were MCP-only
// (jobs.register_source / jobs.fetch_new). The admin panel could only *list*, so the
// owner, touring the live instance, saw one source and no way to add another or to
// pull jobs — the panel just told him to "ask Claude to run jobs.fetch_new". That turns
// a system path into a discipline the owner has to remember (CLAUDE.md rule #10). These
// three handlers call the **same usecases** the MCP tools do (RegisterJobSource /
// UnregisterJobSource / FetchNewJobs), so the two surfaces can never diverge.

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

type registerSourceReq struct {
	Kind   string          `json:"kind"`
	Label  string          `json:"label"`
	Config json.RawMessage `json:"config"`
}

// registerSource — POST /job-sources. Validates the (kind, config) shape **explicitly
// up front** so a bad kind or a missing config field is a 400 carrying the validator's
// own sentence ("greenhouse config: board is required"), not a 500. Anything left after
// that (a DB write failure) is a genuine internal error.
func registerSource(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Jobs == nil {
			writeUnavailable(deps, w)
			return
		}
		req, ok := decodeRegisterReq(deps, w, r)
		if !ok {
			return
		}
		in := &jobsmodel.CreateJobSourceInput{
			OwnerID: authmw.OwnerIDFrom(r.Context()),
			Kind:    req.Kind,
			Label:   req.Label,
			Config:  req.Config,
		}
		src, err := jobsuc.RegisterJobSource(r.Context(), *deps.Jobs, in)
		if err != nil {
			deps.Log.Error("register job source", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeCreatedSource(deps, w, &src)
	}
}

func writeCreatedSource(deps Deps, w http.ResponseWriter, src *jobsmodel.JobSource) {
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(sourceViewOf(src)); err != nil {
		deps.Log.Error("encode registered source", logErrKey, err)
	}
}

func writeUnavailable(deps Deps, w http.ResponseWriter) {
	writeJSONErr(deps.Log, w, apierr.Envelope{
		Status:  http.StatusServiceUnavailable,
		Code:    "unavailable",
		Message: "jobs are not enabled",
	})
}

// decodeRegisterReq — decodes + validates; writes the 400 itself and returns ok=false
// when the request can't be served, so registerSource stays a straight line.
func decodeRegisterReq(
	deps Deps, w http.ResponseWriter, r *http.Request,
) (registerSourceReq, bool) {
	var req registerSourceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeBadRequest(deps, w, "the request body is not valid JSON")
		return req, false
	}
	if req.Label == "" {
		writeBadRequest(deps, w, "give the source a label")
		return req, false
	}
	if len(req.Config) == 0 {
		req.Config = json.RawMessage("{}")
	}
	if err := jobsuc.ValidateSourceConfig(req.Kind, req.Config); err != nil {
		writeBadRequest(deps, w, err.Error())
		return req, false
	}
	return req, true
}

// unregisterSource — DELETE /job-sources/{id}. If the owner can add a source from the
// panel he must be able to take one off it too (same rule as microsites F-P-4).
func unregisterSource(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Jobs == nil {
			writeServerErr(deps.Log, w)
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		id := chi.URLParam(r, "id")
		if err := jobsuc.UnregisterJobSource(r.Context(), *deps.Jobs, ownerID, id); err != nil {
			deps.Log.Error("unregister job source", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// fetchNow — POST /listings/fetch. Pulls every registered source into the pool (the
// same FetchNewJobs the MCP fetch_new tool runs, sourceID=nil = all), then hands back
// the current pool window — so the listings panel can auto-fetch on open and render the
// result without a second round trip. A per-source failure does not fail the call
// (FetchNewJobs records it on the source row and fetches the rest).
func fetchNow(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Jobs == nil {
			writeListingsList(deps.Log, w, nil)
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		res, err := jobsuc.FetchNewJobs(r.Context(), *deps.Jobs, ownerID, nil, 0)
		if err != nil {
			deps.Log.Error("fetch new jobs", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeListingsList(deps.Log, w, res.Jobs)
	}
}

func writeBadRequest(deps Deps, w http.ResponseWriter, msg string) {
	writeJSONErr(deps.Log, w, apierr.Envelope{
		Status:  http.StatusBadRequest,
		Code:    "bad_request",
		Message: msg,
	})
}
