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
	"context"
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
	// RebuildAssetRefs —— recompute this microsite's pool-asset references from its built source,
	// so the delete guard protects a pooled asset a live page embeds (via the SDK AssetWidget).
	// Injected from the corpus side (it owns the asset repo); nil-safe, best-effort.
	RebuildAssetRefs AssetRefRebuilder
}

// AssetRefRebuilder —— recomputes a microsite's pool-asset references from its built source.
type AssetRefRebuilder func(
	ctx context.Context, ownerID, micrositeID string, sources map[string]string,
) error

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
			// The builder's side of this failure is one line — `mark built: 500` — with no id and
			// no reason, so this is the ONLY place the cause is ever written down. Name the build
			// and the status it was reporting: the common cause is a build whose row is gone
			// (its page or owner was deleted while vite was still running), and "no rows in
			// result set" alone cannot be told apart from a genuine database fault.
			deps.Log.Error("patch build",
				"err", perr, "build_id", id, "reported_status", req.Status)
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
	runPostBuiltHooks(r, deps, &built)
	return nil
}

// runPostBuiltHooks —— the side effects of a settled build. Both are best-effort: the build IS
// built, so a hook failure must not fail the builder's report (it's logged, not returned).
//   - auto-go-live the reserved home page the moment its build finishes (any other build is a
//     no-op inside);
//   - recompute the microsite's pool-asset references from the just-built source.
func runPostBuiltHooks(r *http.Request, deps BuilderDeps, built *owner.MicrositeBuild) {
	if aerr := owner.AutopublishHomepageOnBuilt(
		r.Context(), owner.MicrositeDeps{Pages: deps.Pages, Builds: deps.Builds}, built, deps.Log,
	); aerr != nil {
		deps.Log.Error("homepage auto-publish on built", "err", aerr)
	}
	if rerr := rebuildMicrositeAssetRefs(
		r.Context(), deps, built.PageID, built.SourceFiles,
	); rerr != nil {
		deps.Log.Error("microsite asset refs on built", "err", rerr)
	}
}

// rebuildMicrositeAssetRefs —— resolve the build's page → owner, then recompute its asset
// references from the built source (via the injected corpus-side rebuilder). No-op if none wired.
func rebuildMicrositeAssetRefs(
	ctx context.Context, deps BuilderDeps, pageID string, sources map[string]string,
) error {
	if deps.RebuildAssetRefs == nil {
		return nil
	}
	page, err := deps.Pages.GetByID(ctx, pageID)
	if err != nil {
		return fmt.Errorf("load page for asset refs: %w", err)
	}
	return deps.RebuildAssetRefs(ctx, page.OwnerID, pageID, sources)
}

func markFailed(r *http.Request, deps BuilderDeps, id string, req *patchBuildRequest) error {
	if _, err := deps.Builds.MarkFailed(r.Context(), id, req.ErrorMessage); err != nil {
		return fmt.Errorf("mark failed: %w", err)
	}
	return nil
}
