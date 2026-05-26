// applications.go —— admin GET /api/admin/applications —— owner 看 job-loop
// 闭环里已发的申请。commit 走 MCP (applications.commit)，这里只 read +
// 后续 status PATCH。
//
// JSON shape 跟 frontend ApplicationsSection 对齐：
//   { id, company, role, sent_at, method, status, ... }
// resume snapshot 不在 list 视图展开（详情 modal 再单独 fetch）。

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

// ApplicationsAdminDeps —— admin applications 路由的最小依赖。
type ApplicationsAdminDeps struct {
	Apps *postgres.ApplicationRepo
}

// MountApplications 挂 /applications 子路由。
func (h *Handlers) MountApplications(r chi.Router) {
	r.Route("/applications", func(r chi.Router) {
		r.Get("/", h.listAdminApplications())
	})
}

type applicationView struct {
	SubmittedAt time.Time `json:"submitted_at"`
	CreatedAt   time.Time `json:"created_at"`
	ID          string    `json:"id"`
	Company     string    `json:"company"`
	Role        string    `json:"role"`
	Status      string    `json:"status"`
}

func (h *Handlers) listAdminApplications() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := authmw.OwnerIDFrom(r.Context())
		apps, err := h.ApplicationsAdmin.Apps.ListByOwner(r.Context(), ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list applications", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeApplicationsList(h.Log, w, apps)
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
		log.Error("encode applications", "err", err)
	}
}

func nullTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}
