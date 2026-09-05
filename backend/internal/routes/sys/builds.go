// builds.go —— /internal/builds/* —— internal endpoints for the builder service.
// Not exposed to the public internet (mounted under /internal, Caddy blocks it);
// no auth (internal-network trust).
//
// Three endpoints:
//   POST /internal/builds/claim         —— builder polls for pending (atomically marks
//                                          it building before returning); no pending -> 204
//   PATCH /internal/builds/{id}         —— builder reports built / failed when done
//
// Placed in the sys layer because sys is already allowed to depend on postgres + usecases;
// not in the admin / public layer because it must not go through owner-session auth.

package sys

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/buildnotify"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// BuilderDeps —— the deps /internal/builds/* needs.
// Field order follows govet fieldalignment: Log (most-used) goes first to align padding.
type BuilderDeps struct {
	Log    *slog.Logger
	Builds *owner.MicrositeBuildRepo
	// Pages —— needed only so a finished build can auto-go-live the reserved home page
	// (owner.AutopublishHomepageOnBuilt). Every other build ignores it.
	Pages *owner.MicrositeRepo
	// Notifier —— wakes the owner panel's preview long-poll the moment a build settles.
	Notifier *buildnotify.Notifier
}

// MountBuilds mounts /internal/builds/* —— the caller has already added the /internal
// prefix.
func MountBuilds(r chi.Router, deps BuilderDeps) {
	r.Post("/builds/claim", claimBuild(deps))
	r.Patch("/builds/{id}", patchBuild(deps))
}

// claimResponse field order follows govet fieldalignment: the map (pointer-heavy) goes
// first, the three strings follow to keep padding tight.
type claimResponse struct {
	SourceFiles map[string]string `json:"source_files"`
	BuildID     string            `json:"build_id"`
	PageID      string            `json:"page_id"`
	Entry       string            `json:"entry"`
}

func claimBuild(deps BuilderDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		build, err := deps.Builds.ClaimPending(r.Context())
		if err != nil {
			respondClaim(deps, w, err, &build)
			return
		}
		entry := pickEntry(build.SourceFiles)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		resp := claimResponse{
			BuildID:     build.ID,
			PageID:      build.PageID,
			Entry:       entry,
			SourceFiles: build.SourceFiles,
		}
		if encErr := json.NewEncoder(w).Encode(resp); encErr != nil {
			deps.Log.Error("encode claim resp", "err", encErr)
		}
	}
}

func respondClaim(
	deps BuilderDeps, w http.ResponseWriter, err error, _ *owner.MicrositeBuild,
) {
	if errors.Is(err, owner.ErrMicrositeBuildNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	deps.Log.Error("claim build", "err", err)
	http.Error(w, "claim build failed", http.StatusInternalServerError)
}

// pickEntry —— prefers App.tsx in source_files; otherwise takes the first .tsx; falls
// back to 'App.tsx' if neither exists.
func pickEntry(files map[string]string) string {
	if _, ok := files["App.tsx"]; ok {
		return "App.tsx"
	}
	if k, ok := firstTSX(files); ok {
		return k
	}
	return "App.tsx"
}

func firstTSX(files map[string]string) (string, bool) {
	for k := range files {
		if hasTSXSuffix(k) {
			return k, true
		}
	}
	return "", false
}

func hasTSXSuffix(s string) bool {
	const suf = ".tsx"
	return len(s) > len(suf) && s[len(s)-len(suf):] == suf
}

type patchBuildRequest struct {
	Status       string `json:"status"`
	OutputPath   string `json:"output_path"`
	ErrorMessage string `json:"error_message"`
}

func patchBuild(deps BuilderDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req patchBuildRequest
		if derr := json.NewDecoder(r.Body).Decode(&req); derr != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		if perr := applyPatch(r, deps, id, &req); perr != nil {
			deps.Log.Error("patch build", "err", perr)
			http.Error(w, "patch build failed", http.StatusInternalServerError)
			return
		}
		// A build settled (built or failed) → wake the owner panel's preview long-poll.
		deps.Notifier.Signal()
		w.WriteHeader(http.StatusNoContent)
	}
}

func applyPatch(
	r *http.Request, deps BuilderDeps, id string, req *patchBuildRequest,
) error {
	switch req.Status {
	case "built":
		return markBuilt(r, deps, id, req)
	case "failed":
		return markFailed(r, deps, id, req)
	}
	return errors.New("status must be built|failed")
}

func markBuilt(r *http.Request, deps BuilderDeps, id string, req *patchBuildRequest) error {
	built, err := deps.Builds.MarkBuilt(r.Context(), id, req.OutputPath)
	if err != nil {
		return fmt.Errorf("mark built: %w", err)
	}
	// Auto-go-live the reserved home page the moment its build finishes (A Slice 5). Any other
	// build is a no-op inside. Its failure must not fail the builder's report — the build IS built.
	if aerr := owner.AutopublishHomepageOnBuilt(
		r.Context(), owner.MicrositeDeps{Pages: deps.Pages, Builds: deps.Builds}, &built, deps.Log,
	); aerr != nil {
		deps.Log.Error("homepage auto-publish on built", "err", aerr)
	}
	return nil
}

func markFailed(r *http.Request, deps BuilderDeps, id string, req *patchBuildRequest) error {
	if _, err := deps.Builds.MarkFailed(r.Context(), id, req.ErrorMessage); err != nil {
		return fmt.Errorf("mark failed: %w", err)
	}
	return nil
}
