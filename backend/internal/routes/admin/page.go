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

	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// PageAdminDeps —— admin page handlers 依赖。PageContent 走 OwnerRepo
// 的 GetPageContent / UpsertPageContent 方法（Owner aggregate 内容切面）。
// Pins 给 pin 校验(insights/projects 是 corpus pin 列表,pinned ⊆ published
// 在写入点由 usecases.ValidatePagePins 维护)+ pinnable 候选列表。
type PageAdminDeps struct {
	Owners *owner.Repo
	Pins   usecases.PagePinDeps
}

// MountPage 挂 /page。caller 负责 /api/admin/ 前缀 + auth middleware。
func (h *Handlers) MountPage(r chi.Router) {
	r.Get("/page", h.getPage())
	r.Put("/page", h.putPage())
	r.Get("/page/pinnable", h.getPinnable())
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
	ctx context.Context, repo *owner.Repo, ownerID string,
) (owner.PageContent, error) {
	content, err := repo.GetPageContent(ctx, ownerID)
	if err == nil {
		return content, nil
	}
	if errors.Is(err, owner.ErrPageNotFound) {
		return defaultContentForOwner(ownerID), nil
	}
	return owner.PageContent{}, err
}

// defaultContentForOwner —— GET 第一次访问时返一份 page-content.js 风格的
// 默认草稿，让 owner 直接基于这个改而不是从空白起步。复用 usecase 层的
// public 默认（已经按设计稿写好）。
func defaultContentForOwner(ownerID string) owner.PageContent {
	return usecases.DefaultPageContent(ownerID)
}

func (h *Handlers) putPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var body owner.PageContent
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		body.OwnerID = ownerID
		savePutPage(h, w, r, &body)
	}
}

// savePutPage —— pin 校验(同一个 maintainer,拒未发布/不存在)→ 保存。
func savePutPage(
	h *Handlers, w http.ResponseWriter, r *http.Request, body *owner.PageContent,
) {
	if verr := usecases.ValidatePagePins(
		r.Context(), h.PageAdmin.Pins, body.OwnerID, body,
	); verr != nil {
		handlePagePinErr(h, w, verr)
		return
	}
	saved, err := h.PageAdmin.Owners.UpsertPageContent(r.Context(), body.OwnerID, body)
	if err != nil {
		h.Log.Error("admin put page", "err", err)
		writeError(h.Log, w, serverErr())
		return
	}
	writeAdminPage(h.Log, w, &saved)
}

func handlePagePinErr(h *Handlers, w http.ResponseWriter, err error) {
	if errors.Is(err, owner.ErrPinUnpublished) {
		writeError(h.Log, w, envBadReq("pinned entry is not published — publish it first"))
		return
	}
	if errors.Is(err, owner.ErrPinNotFound) {
		writeError(h.Log, w, envBadReq("pinned entry not found"))
		return
	}
	h.Log.Error("admin page pins", "err", err)
	writeError(h.Log, w, serverErr())
}

// getPinnable —— pin 候选:published 的 wiki 条目(id/title/path),给 admin
// pin manager 的选择器。
func (h *Handlers) getPinnable() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		items, err := loadPinnable(r.Context(), h.PageAdmin.Pins, ownerID)
		if err != nil {
			h.Log.Error("admin page pinnable", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(items); eerr != nil {
			h.Log.Error("encode pinnable", "err", eerr)
		}
	}
}

type pinnableEntry struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Path  string `json:"path"`
}

func loadPinnable(
	ctx context.Context, pins usecases.PagePinDeps, ownerID string,
) ([]pinnableEntry, error) {
	metas, err := pins.Wiki.ListAllMeta(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	paths := usecases.WikiMetaTreePaths(metas)
	return publishedPinnable(metas, paths), nil
}

// publishedPinnable —— only published wiki entries are pinnable (pinned ⊆ published).
func publishedPinnable(metas []postgres.WikiMeta, paths map[string]string) []pinnableEntry {
	items := []pinnableEntry{}
	for i := range metas {
		if !metas[i].Published {
			continue
		}
		items = append(items, pinnableEntry{
			ID: metas[i].ID, Title: metas[i].Title, Path: paths[metas[i].ID],
		})
	}
	return items
}

func writeAdminPage(log *slog.Logger, w http.ResponseWriter, content *owner.PageContent) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(content); err != nil {
		log.Error("encode admin page", logErrKey, err)
	}
}
