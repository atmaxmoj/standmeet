// Package jobsadmin — J.4: the jobs plugin's admin REST endpoints.
// Currently two list views:
//   - GET /api/admin/drafts        — owner sees the resume draft list
//   - GET /api/admin/applications  — owner sees the list of committed applications
//
// These two used to live in internal/routes/admin/, sharing the big
// admin.Handlers struct with corpus / codes / page. The J phase pulled the
// outbound job-hunting chain out into a plugin, and the routes moved into
// their own package too, to keep Handlers from bloating (G-1.5 smell E).
//
// Editing / deleting a draft goes through MCP capabilities (resume.*) — see
// plugins/jobs/jobsmcp/.
//
// **Both surfaces grew a commit path** (F-E-9). This used to say "only
// exposes an owner read-only list", while the panel's `SEND →` button
// opened a confirmation dialog promising, item by item, "freeze snapshot /
// render a PDF with QR / write an application row / auto-issue a 180-day
// code", and then `onSend` was wired to `onClose` — no request went out at
// all. The owner would believe they'd applied.
// The two paths call the **same usecase** (`jobsuc.CommitApplication`), not
// a second implementation.
package jobsadmin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

const (
	logErrKey = "err"
	ctHeader  = "Content-Type"
	ctJSON    = "application/json"
)

// Deps — dependencies for the jobs admin routes. Log is required (encode
// failures need logging).
type Deps struct {
	Apps    *jobsuc.ApplicationRepo
	Drafts  *jobsuc.ResumeDraftRepo
	Sources *jobsuc.JobSourceRepo
	// Jobs — the pool's usecase. The listings surface **doesn't read Redis
	// itself**: it goes through the same `jobsuc.ListPoolBoard` as
	// `jobs.fetch_new`, so the two surfaces can never show different boards
	// for the same pool.
	Jobs *jobsuc.JobsDeps
	// Commit — the set of dependencies needed to commit a draft (renderer /
	// owner / role). **Shared with** the applications.commit path, so the
	// two surfaces cannot diverge on what happens for the same commit.
	Commit *jobsuc.ApplicationsDeps
	Log    *slog.Logger
}

// Mount hangs /drafts + /applications + /job-sources off the given router.
// The caller is responsible for wrapping it beforehand with WithOwner /
// RequireCSRF middleware (the shared admin auth stack).
func Mount(r chi.Router, deps Deps) {
	r.Route("/drafts", func(r chi.Router) {
		r.Get("/", listDrafts(deps))
		r.Get("/{id}", getDraft(deps))
		r.Post("/{id}/commit", commitDraft(deps))
	})
	r.Route("/applications", func(r chi.Router) {
		r.Get("/", listApplications(deps))
	})
	r.Route("/job-sources", func(r chi.Router) {
		r.Get("/", listSources(deps))
	})
	r.Route("/listings", func(r chi.Router) {
		r.Get("/", listListings(deps))
	})
}

// ───── listings ──────────────────────────────────────────────
//
// #50: owner views the FetchedJobs currently sitting (uncommitted) in the
// pool — ephemeral 1d-TTL, SCANned straight from the Redis pool, never
// persisted. No cache → empty list (degrade gracefully, don't error).

type listingView struct {
	PublishedAt time.Time `json:"published_at"`
	CacheID     string    `json:"cache_id"`
	Title       string    `json:"title"`
	Company     string    `json:"company"`
	Location    string    `json:"location"`
	URL         string    `json:"url"`
	SourceKind  string    `json:"source_kind"`
	Tags        []string  `json:"tags"`
}

// listListings — this surface reads **the same board the owner sees when
// asking Claude** (`jobsuc.ListPoolBoard`), not a separate SCAN of Redis.
// If the two surfaces each assembled their own answer, a cross-source
// duplicate would show up on one and not the other, and when the counts
// disagreed nothing would say which one was wrong (a sibling of F-E-29).
func listListings(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Jobs == nil {
			writeListingsList(deps.Log, w, nil)
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		// since<=0 = the whole live pool: the panel doesn't window it, the
		// pool itself expires after 24h.
		rows, err := jobsuc.ListPoolBoard(r.Context(), *deps.Jobs, ownerID, 0)
		if err != nil {
			deps.Log.Error("list job pool", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeListingsList(deps.Log, w, rows)
	}
}

func writeListingsList(
	log *slog.Logger, w http.ResponseWriter, rows []jobsuc.PoolRow,
) {
	items := make([]listingView, 0, len(rows))
	for i := range rows {
		j := &rows[i].Job
		items = append(items, listingView{
			CacheID:     j.CacheID,
			Title:       j.Title,
			Company:     j.Company,
			Location:    j.Location,
			URL:         j.URL,
			SourceKind:  j.SourceKind,
			PublishedAt: j.PublishedAt,
			Tags:        tagsOrEmpty(j.Tags),
		})
	}
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode listings", logErrKey, err)
	}
}

func tagsOrEmpty(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}

// ───── sources ───────────────────────────────────────────────

type sourceView struct {
	LastFetchedAt *time.Time `json:"last_fetched_at"`
	// LastAttemptedAt / LastError — when the last **attempt** happened and
	// how it went (empty string = succeeded). This page needs to answer "is
	// this source still alive", and with only last_fetched_at, a source that
	// fails every time and a source that's never been touched read as the
	// same sentence on screen (F-E-18).
	LastAttemptedAt *time.Time `json:"last_attempted_at"`
	CreatedAt       time.Time  `json:"created_at"`
	ID              string     `json:"id"`
	Kind            string     `json:"kind"`
	Label           string     `json:"label"`
	LastError       string     `json:"last_error"`
}

func listSources(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		sources, err := deps.Sources.ListByOwner(r.Context(), ownerID)
		if err != nil {
			deps.Log.Error("list job sources", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeSourcesList(deps.Log, w, sources)
	}
}

func writeSourcesList(
	log *slog.Logger, w http.ResponseWriter, sources []jobsmodel.JobSource,
) {
	items := make([]sourceView, 0, len(sources))
	for i := range sources {
		items = append(items, sourceView{
			ID:              sources[i].ID,
			Kind:            sources[i].Kind,
			Label:           sources[i].Label,
			LastFetchedAt:   sources[i].LastFetchedAt,
			LastAttemptedAt: sources[i].LastAttemptedAt,
			LastError:       sources[i].LastError,
			CreatedAt:       sources[i].CreatedAt,
		})
	}
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode job sources", logErrKey, err)
	}
}

// ───── drafts ────────────────────────────────────────────────
//
// The drafts family lives in drafts.go (this file hit the 350-line cap).

// ───── applications ──────────────────────────────────────────

// applicationView — a single submitted application. **Carries
// resume_content**: the "RESUME SENT · SNAPSHOT" block on the detail card
// exists precisely to answer "what did I actually send", and it used to
// render an empty delta line — even though the content was persisted right
// there on the application row (the PDF rendered at commit time came from
// it), the panel just couldn't see it (F-E-23). This adds no extra query:
// the row `ListByOwner` fetches already carries it.
type applicationView struct {
	SubmittedAt   time.Time               `json:"submitted_at"`
	CreatedAt     time.Time               `json:"created_at"`
	ID            string                  `json:"id"`
	Company       string                  `json:"company"`
	Role          string                  `json:"role"`
	Status        string                  `json:"status"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
}

func listApplications(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		apps, err := deps.Apps.ListByOwner(r.Context(), ownerID)
		if err != nil {
			deps.Log.Error("list applications", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeApplicationsList(deps.Log, w, apps)
	}
}

func writeApplicationsList(
	log *slog.Logger, w http.ResponseWriter, apps []jobsmodel.Application,
) {
	items := make([]applicationView, 0, len(apps))
	for i := range apps {
		items = append(items, applicationView{
			ID:            apps[i].ID,
			Company:       apps[i].JobSnapshot.Company,
			Role:          apps[i].JobSnapshot.Title,
			Status:        apps[i].Status,
			SubmittedAt:   nullTime(apps[i].SubmittedAt),
			CreatedAt:     apps[i].CreatedAt,
			ResumeContent: apps[i].ResumeContent,
		})
	}
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode applications", logErrKey, err)
	}
}

// ───── shared helpers ────────────────────────────────────────

func writeServerErr(log *slog.Logger, w http.ResponseWriter) {
	writeJSONErr(log, w, apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	})
}

func writeJSONErr(log *slog.Logger, w http.ResponseWriter, env apierr.Envelope) {
	w.Header().Set(ctHeader, ctJSON)
	w.WriteHeader(env.Status)
	payload := map[string]map[string]string{
		"error": {"code": env.Code, "message": env.Message},
	}
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Error("encode error response", logErrKey, err)
	}
}

func nullTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}
