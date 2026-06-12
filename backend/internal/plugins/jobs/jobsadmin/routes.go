// Package jobsadmin —— J.4: jobs plugin 的 admin REST endpoints。
// 当前两个 list 视图：
//   - GET /api/admin/drafts        —— owner 看 resume draft 列表
//   - GET /api/admin/applications  —— owner 看 commit 完的 application 列表
//
// 这俩之前住 internal/routes/admin/ 里，跟 corpus / codes / page 共享
// admin.Handlers 大结构体。J phase 把 outbound 求职链拎成 plugin，路由
// 也独立成包，避免 Handlers 膨胀 (G-1.5 smell E)。
//
// 写 / 改 / 删 草稿和 commit application 全走 MCP capabilities
// (resume.* / applications.commit) —— 见 plugins/jobs/jobsmcp/。
// 这里只暴露 owner read-only 列表。
package jobsadmin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	authmw "github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const logErrKey = "err"

// Deps —— jobs admin 路由依赖。Log 必填 (encode 失败要 log)。
type Deps struct {
	Apps    *postgres.ApplicationRepo
	Drafts  *postgres.ResumeDraftRepo
	Sources *postgres.JobSourceRepo
	Log     *slog.Logger
}

// Mount 挂 /drafts + /applications + /job-sources 到入参 router。caller 负责
// 事先用 WithOwner / RequireCSRF middleware 包好 (admin 共享认证栈)。
func Mount(r chi.Router, deps Deps) {
	r.Route("/drafts", func(r chi.Router) {
		r.Get("/", listDrafts(deps))
		r.Get("/{id}", getDraft(deps))
	})
	r.Route("/applications", func(r chi.Router) {
		r.Get("/", listApplications(deps))
	})
	r.Route("/job-sources", func(r chi.Router) {
		r.Get("/", listSources(deps))
	})
}

// ───── sources ───────────────────────────────────────────────

type sourceView struct {
	LastFetchedAt *time.Time `json:"last_fetched_at"`
	CreatedAt     time.Time  `json:"created_at"`
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	Label         string     `json:"label"`
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
	log *slog.Logger, w http.ResponseWriter, sources []domain.JobSource,
) {
	items := make([]sourceView, 0, len(sources))
	for i := range sources {
		items = append(items, sourceView{
			ID:            sources[i].ID,
			Kind:          sources[i].Kind,
			Label:         sources[i].Label,
			LastFetchedAt: sources[i].LastFetchedAt,
			CreatedAt:     sources[i].CreatedAt,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode job sources", logErrKey, err)
	}
}

// ───── drafts ────────────────────────────────────────────────

type draftView struct {
	UpdatedAt time.Time `json:"updated_at"`
	ID        string    `json:"id"`
	Company   string    `json:"company"`
	Role      string    `json:"role"`
	ForJob    string    `json:"for_job"`
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

// draftDetailView —— #52: composer 打开时拿真 resume_content(+ job context),
// 替代 mockDraft 占位。resume_content 直接透传 domain 形状(已有 json tags)。
type draftDetailView struct {
	ID            string               `json:"id"`
	Company       string               `json:"company"`
	Role          string               `json:"role"`
	ResumeContent domain.ResumeContent `json:"resume_content"`
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
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(view); eerr != nil {
			deps.Log.Error("encode draft detail", logErrKey, eerr)
		}
	}
}

func handleDraftDetailErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, domain.ErrResumeDraftNotFound) {
		writeJSONErr(log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "draft_not_found", Message: "draft not found",
		})
		return
	}
	log.Error("get draft", logErrKey, err)
	writeServerErr(log, w)
}

func writeDraftsList(
	log *slog.Logger, w http.ResponseWriter, drafts []domain.ResumeDraft,
) {
	items := make([]draftView, 0, len(drafts))
	for i := range drafts {
		items = append(items, draftView{
			ID:        drafts[i].ID,
			Company:   drafts[i].JobSnapshot.Company,
			Role:      drafts[i].JobSnapshot.Title,
			ForJob:    drafts[i].JobCacheID,
			UpdatedAt: drafts[i].CreatedAt,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(items); err != nil {
		log.Error("encode drafts", logErrKey, err)
	}
}

// ───── applications ──────────────────────────────────────────

type applicationView struct {
	SubmittedAt time.Time `json:"submitted_at"`
	CreatedAt   time.Time `json:"created_at"`
	ID          string    `json:"id"`
	Company     string    `json:"company"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
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
	log *slog.Logger, w http.ResponseWriter, apps []domain.Application,
) {
	items := make([]applicationView, 0, len(apps))
	for i := range apps {
		items = append(items, applicationView{
			ID:          apps[i].ID,
			Company:     apps[i].JobSnapshot.Company,
			Role:        apps[i].JobSnapshot.Title,
			Status:      apps[i].Status,
			SubmittedAt: nullTime(apps[i].SubmittedAt),
			CreatedAt:   apps[i].CreatedAt,
		})
	}
	w.Header().Set("Content-Type", "application/json")
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
	w.Header().Set("Content-Type", "application/json")
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
