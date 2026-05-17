// page.go —— GET /api/v1/page/:handle —— 访客取 owner 的公开页内容。
// 不需要鉴权（公开）。owner 不存在返 404 + owner_not_found。

package public

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/apierr"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// PageHandlers —— page route 依赖。
type PageHandlers struct {
	Page usecases.PageDeps
	Log  *slog.Logger
}

// Mount 挂 /page/:handle 和 /instance。caller 负责前缀。
func (h *PageHandlers) Mount(r chi.Router) {
	r.Get("/page/{handle}", h.getPage())
	r.Get("/instance", h.getInstance())
}

// getInstance —— v1 单 owner instance：返回首位 owner 的 handle，让前端
// 根路径能跳到 /<handle>。未 claim 时返 {handle:""}（不返 404 让 app 自己
// 显示 setup 引导）。
func (h *PageHandlers) getInstance() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle, err := usecases.GetDefaultHandle(r.Context(), h.Page)
		if err != nil {
			h.Log.Error("get default handle", "err", err)
			writeError(h.Log, w, apierr.Envelope{
				Status:  http.StatusInternalServerError,
				Code:    "server_error",
				Message: "internal error",
			})
			return
		}
		writeInstanceInfo(h.Log, w, handle)
	}
}

func writeInstanceInfo(log *slog.Logger, w http.ResponseWriter, handle string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(instanceInfoView{Handle: handle}); err != nil {
		log.Error("encode instance info", "err", err)
	}
}

type instanceInfoView struct {
	Handle string `json:"handle"`
}

func (h *PageHandlers) getPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := chi.URLParam(r, "handle")
		view, err := usecases.GetPublicPage(r.Context(), h.Page, handle)
		if err != nil {
			handlePageErr(h.Log, w, err)
			return
		}
		writePageView(h.Log, w, &view)
	}
}

func writePageView(log *slog.Logger, w http.ResponseWriter, view *usecases.PublicPageView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode page view", "err", err)
	}
}

func handlePageErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyPageErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("page route", "err", err)
	}
	writeError(log, w, env)
}

func classifyPageErr(err error) apierr.Envelope {
	if errors.Is(err, usecases.ErrEmptyField) {
		return apierr.Envelope{
			Status: http.StatusBadRequest, Code: "bad_request", Message: "missing handle",
		}
	}
	if errors.Is(err, domain.ErrOwnerNotFound) {
		return apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "owner_not_found",
			Message: "owner handle not registered",
		}
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
