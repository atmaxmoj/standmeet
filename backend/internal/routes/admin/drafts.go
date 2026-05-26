// drafts.go —— admin GET /api/admin/drafts —— owner 看 job-loop 起的
// resume drafts。仅 list；create / update / delete 走 MCP (resume.draft /
// resume.update_draft / resume.discard_draft)。
//
// JSON shape 跟 frontend Application UI 对齐：
//   { id, company, role, for_job, match_pct, updated_at }
// match_pct 是 mock 占位（真 ML score 在 resume.draft 时已经算）。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	authmw "github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// DraftsAdminDeps —— admin drafts 路由的最小依赖。
type DraftsAdminDeps struct {
	Drafts *postgres.ResumeDraftRepo
}

// MountDrafts 挂 /drafts 子路由。
func (h *Handlers) MountDrafts(r chi.Router) {
	r.Route("/drafts", func(r chi.Router) {
		r.Get("/", h.listAdminDrafts())
	})
}

// draftView —— admin list 响应单条。jsonb 字段 (job_snapshot /
// resume_content) 在 list 视图不展开，只回 owner 看 card 用的元数据。
type draftView struct {
	UpdatedAt time.Time `json:"updated_at"`
	ID        string    `json:"id"`
	Company   string    `json:"company"`
	Role      string    `json:"role"`
	ForJob    string    `json:"for_job"`
}

func (h *Handlers) listAdminDrafts() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		drafts, err := h.DraftsAdmin.Drafts.ListByOwner(r.Context(), ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list drafts", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeDraftsList(h.Log, w, drafts)
	}
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
		log.Error("encode drafts", "err", err)
	}
}
