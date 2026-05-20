// page.go —— /api/admin/page —— owner 编辑自己的 public page 内容。
// GET 返当前内容（未填过返默认值）；PUT 整段替换。所有字段都 PUT 过来
// （前端 fetch + edit + send，简单可靠）。

package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// PageAdminDeps —— admin page handlers 依赖。PageContent 走 OwnerRepo
// 的 GetPageContent / UpsertPageContent 方法（Owner aggregate 内容切面）。
type PageAdminDeps struct {
	Owners *postgres.OwnerRepo
}

// MountPage 挂 /page。caller 负责 /api/admin/ 前缀 + auth middleware。
func (h *Handlers) MountPage(r chi.Router) {
	r.Get("/page", h.getPage())
	r.Put("/page", h.putPage())
}

func (h *Handlers) getPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		content, err := loadOwnerPage(r.Context(), h.PageAdmin.Owners, ownerID)
		if err != nil {
			h.Log.Error("admin get page", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeAdminPage(h.Log, w, &content)
	}
}

func loadOwnerPage(
	ctx context.Context, repo *postgres.OwnerRepo, ownerID string,
) (domain.PageContent, error) {
	content, err := repo.GetPageContent(ctx, ownerID)
	if err == nil {
		return content, nil
	}
	if errors.Is(err, domain.ErrPageNotFound) {
		return defaultContentForOwner(ownerID), nil
	}
	return domain.PageContent{}, err
}

// defaultContentForOwner —— GET 第一次访问时返一份 page-content.js 风格的
// 默认草稿，让 owner 直接基于这个改而不是从空白起步。复用 usecase 层的
// public 默认（已经按设计稿写好）。
func defaultContentForOwner(ownerID string) domain.PageContent {
	return usecases.DefaultPageContent(ownerID)
}

func (h *Handlers) putPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body domain.PageContent
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		body.OwnerID = ownerID
		saved, err := h.PageAdmin.Owners.UpsertPageContent(r.Context(), ownerID, &body)
		if err != nil {
			h.Log.Error("admin put page", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeAdminPage(h.Log, w, &saved)
	}
}

func writeAdminPage(log *slog.Logger, w http.ResponseWriter, content *domain.PageContent) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(content); err != nil {
		log.Error("encode admin page", "err", err)
	}
}
