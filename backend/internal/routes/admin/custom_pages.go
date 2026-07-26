// custom_pages.go —— admin GET /api/admin/custom-pages 列 owner 的 React 自定义页。
//
// owner 通过 MCP 工具（custom_page.create / write_file / build / promote_to_live）
// 管理 custom_pages；admin UI 这个 list 只读视图 + "view live ↗" 链接，让
// owner 不开 Claude 也能确认页面发布状态 + 直接看 live 版本。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// MountCustomPages 挂 GET /custom-pages（admin 列表，只读视图）。
// 写操作（create / write_file / build / promote / rollback / delete）走 MCP
// tool，不暴露 admin endpoint —— 一处来源比两份并行更干净。
func (h *Handlers) MountCustomPages(r chi.Router) {
	r.Get("/custom-pages", h.listCustomPages())
}

type customPageView struct {
	ID          string `json:"id"`
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	LiveBuildID string `json:"live_build_id,omitempty"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	HasLive     bool   `json:"has_live"`    // LiveBuildID 非 nil → "view live ↗" 可点
	HasStaging  bool   `json:"has_staging"` // 已 build 但未 promote
}

func (h *Handlers) listCustomPages() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		pages, err := usecases.ListPages(r.Context(), h.CustomPages, ownerID)
		if err != nil {
			logEncodeErr(h.Log, "list custom pages", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeCustomPages(h.Log, w, pages)
	}
}

func writeCustomPages(log *slog.Logger, w http.ResponseWriter, pages []ownerdomain.CustomPage) {
	views := make([]customPageView, 0, len(pages))
	for i := range pages {
		views = append(views, toCustomPageView(&pages[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(views); err != nil {
		log.Error("encode custom pages", "err", err)
	}
}

func toCustomPageView(p *ownerdomain.CustomPage) customPageView {
	v := customPageView{
		ID:         p.ID,
		Slug:       p.Slug,
		Title:      p.Title,
		Status:     p.Status,
		HasLive:    p.LiveBuildID != nil,
		HasStaging: p.StagingBuildID != nil,
		CreatedAt:  p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:  p.UpdatedAt.Format(time.RFC3339),
	}
	if p.LiveBuildID != nil {
		v.LiveBuildID = *p.LiveBuildID
	}
	return v
}
