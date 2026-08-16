// Package jobsadmin —— J.4: jobs plugin 的 admin REST endpoints。
// 当前两个 list 视图：
//   - GET /api/admin/drafts        —— owner 看 resume draft 列表
//   - GET /api/admin/applications  —— owner 看 commit 完的 application 列表
//
// 这俩之前住 internal/routes/admin/ 里，跟 corpus / codes / page 共享
// admin.Handlers 大结构体。J phase 把 outbound 求职链拎成 plugin，路由
// 也独立成包，避免 Handlers 膨胀 (G-1.5 smell E)。
//
// 改 / 删 草稿走 MCP capabilities (resume.*) —— 见 plugins/jobs/jobsmcp/。
//
// **commit 两个面都长**（F-E-9）。这里原来写着「只暴露 owner read-only 列表」，
// 而面板上那颗 `SEND →` 按钮弹了一张确认框、逐条许诺「冻结快照 / 渲染带 QR 的 PDF /
// 写 application 行 / 自动发一张 180 天的码」，然后 `onSend` 接的是 `onClose` ——
// 一个请求都不发。owner 会以为自己投出去了。
// 两条路打的是**同一个 usecase**（`jobsuc.CommitApplication`），不是第二份实现。
package jobsadmin

import (
	"context"
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

// PoolLister —— jobsadmin 对 job 池子的只读视图（#50 listings）。用接口而非
// 直接依赖 plugins/jobs/cache，避免 arch-lint 组件越界依赖；cache.Pool 满足它。
type PoolLister interface {
	ListByOwner(ctx context.Context, ownerID string) ([]jobsmodel.FetchedJob, error)
}

// Deps —— jobs admin 路由依赖。Log 必填 (encode 失败要 log)。
type Deps struct {
	Apps    *jobsuc.ApplicationRepo
	Drafts  *jobsuc.ResumeDraftRepo
	Sources *jobsuc.JobSourceRepo
	Pool    PoolLister
	// Commit —— commit 一份草稿要的那组依赖（渲染器 / owner / role）。跟
	// applications.commit 那条路**共用同一份**，两个面因此不可能对同一次 commit
	// 做不同的事。
	Commit *jobsuc.ApplicationsDeps
	Log    *slog.Logger
}

// Mount 挂 /drafts + /applications + /job-sources 到入参 router。caller 负责
// 事先用 WithOwner / RequireCSRF middleware 包好 (admin 共享认证栈)。
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
// #50: owner 看池子里现存(未 commit)的 FetchedJob —— ephemeral 1d-TTL，
// 直接从 Redis 池子 SCAN，不落库。无 cache → 空列表(降级，不报错)。

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

func listListings(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if deps.Pool == nil {
			writeListingsList(deps.Log, w, nil)
			return
		}
		ownerID := authmw.OwnerIDFrom(r.Context())
		jobs, err := deps.Pool.ListByOwner(r.Context(), ownerID)
		if err != nil {
			deps.Log.Error("list job pool", logErrKey, err)
			writeServerErr(deps.Log, w)
			return
		}
		writeListingsList(deps.Log, w, jobs)
	}
}

func writeListingsList(
	log *slog.Logger, w http.ResponseWriter, jobs []jobsmodel.FetchedJob,
) {
	items := make([]listingView, 0, len(jobs))
	for i := range jobs {
		items = append(items, listingView{
			CacheID:     jobs[i].CacheID,
			Title:       jobs[i].Title,
			Company:     jobs[i].Company,
			Location:    jobs[i].Location,
			URL:         jobs[i].URL,
			SourceKind:  jobs[i].SourceKind,
			PublishedAt: jobs[i].PublishedAt,
			Tags:        tagsOrEmpty(jobs[i].Tags),
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
	// LastAttemptedAt / LastError —— 上一次**试过**是什么时候、结果如何（空串 = 成了）。
	// 这一页要回答的是「我这个源还活着吗」，而只有 last_fetched_at 时，
	// 一个每次都失败的源跟一个从没被碰过的源在屏幕上是同一句话（F-E-18）。
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
// drafts 那一族住在 drafts.go（这个文件到了 350 行上限）。

// ───── applications ──────────────────────────────────────────

// applicationView —— 一条已提交的申请。**带上 resume_content**：详情卡的
// 「RESUME SENT · SNAPSHOT」那一块要回答的正是「我到底发出去了什么」，而它以前只渲一行
// 空的 delta —— 内容明明持久化在申请行里（commit 那一刻的 PDF 就是从它渲的），
// 面板却看不到（F-E-23）。这里不多查一次库：`ListByOwner` 取回的行本来就带着它。
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
