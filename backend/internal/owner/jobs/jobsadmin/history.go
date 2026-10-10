// history.go —— GET /api/admin/listings/history: the owner's seen ledger, newest first, for the
// panel's history view beside the pool (job-loop roadmap 8.3.b). The same use case and wire shape
// as MCP jobs.history.

package jobsadmin

import (
	"net/http"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

func listHistory(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req, perr := pageRequest(r)
		q := r.URL.Query()
		f, ferr := jobsuc.SeenFilterOf(q.Get("from"), q.Get("to"), q.Get("status"))
		if perr != nil || ferr != nil {
			writeJSONErr(deps.Log, w, badRequest("bad cursor, day or status"))
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		page, err := jobsuc.History(r.Context(), deps.Jobs, ownerID, &f, req)
		if err != nil {
			deps.Log.Error("job history", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeJSON(deps.Log, w, http.StatusOK, paging.Each(page, jobsmodel.SeenWireOf))
	}
}
