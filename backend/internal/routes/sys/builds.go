// builds.go —— /internal/builds/* —— 给 builder service 内部用的 endpoints。
// 不对公网暴露（挂在 /internal 下，Caddy 会拦）；不做鉴权（内网信任）。
//
// 三个 endpoint：
//   POST /internal/builds/claim         —— builder 轮询拿 pending（原子标
//                                          building 后返）；无 pending 返 204
//   PATCH /internal/builds/{id}         —— builder 跑完汇报 built / failed
//
// 接出 sys layer 是因为 sys 已经允许依赖 postgres + usecases；不在 admin /
// public layer 因为不该走 owner session 鉴权。

package sys

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// BuilderDeps —— /internal/builds/* 需要的 dep。
// 字段顺序按 govet fieldalignment：把 Log（最常用）放前面对齐 padding。
type BuilderDeps struct {
	Log    *slog.Logger
	Builds *postgres.CustomBuildRepo
}

// MountBuilds 挂 /internal/builds/* —— caller 已经加 /internal 前缀。
func MountBuilds(r chi.Router, deps BuilderDeps) {
	r.Post("/builds/claim", claimBuild(deps))
	r.Patch("/builds/{id}", patchBuild(deps))
}

// claimResponse 字段顺序按 govet fieldalignment：map（pointer-heavy）放前，
// 三个 string 跟在后面让 padding 紧凑。
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

func respondClaim(deps BuilderDeps, w http.ResponseWriter, err error, _ *domain.CustomPageBuild) {
	if errors.Is(err, domain.ErrCustomPageBuildNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	deps.Log.Error("claim build", "err", err)
	http.Error(w, "claim build failed", http.StatusInternalServerError)
}

// pickEntry —— source_files 里看 App.tsx 优先；否则取第一个 .tsx；都没就 'App.tsx'。
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
	if _, err := deps.Builds.MarkBuilt(r.Context(), id, req.OutputPath); err != nil {
		return fmt.Errorf("mark built: %w", err)
	}
	return nil
}

func markFailed(r *http.Request, deps BuilderDeps, id string, req *patchBuildRequest) error {
	if _, err := deps.Builds.MarkFailed(r.Context(), id, req.ErrorMessage); err != nil {
		return fmt.Errorf("mark failed: %w", err)
	}
	return nil
}
