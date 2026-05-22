// page.go —— GET /api/v1/page —— 访客取 sole owner 的公开页内容。
// 不需要鉴权（公开）。pre-claim → 404 + owner_not_found。
//
// 删 handle URL 之后：v1 单 owner instance，URL 不再带 handle。前端的
// 根路由 / 直接 SSR fetch /api/v1/page，没有 sub-route 分支。

package public

import (
	"context"
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
	Page        usecases.PageDeps
	Log         *slog.Logger
	TokenIssuer usecases.SetupTokenIssuer // 仅 unclaimed 时调；handler 通过它取 / self-heal plaintext
}

// Mount 挂 /page + /instance。caller 负责前缀（/api/v1）。
func (h *PageHandlers) Mount(r chi.Router) {
	r.Get("/page", h.getPage())
	r.Get("/instance", h.getInstance())
}

// getInstance —— v1 单 owner instance 元信息。返回 {claimed, handle, setup_token?}。
// 前端 / 根路由的 SSR fetch 它：
//   - claimed=true → 渲染 sole owner 公开页（owner.handle 用来显示）
//   - claimed=false → server-side redirect 到 /setup?t=<setup_token>，让首次
//     访问的 operator 不用复制 stdout banner 就能进 claim 流程
//
// setup_token 只在 unclaimed 期返回；一旦 claim 成功 holder 里残值已经
// 没用（claim 流程清掉了 setup_token_hash，旧 plaintext 任何后续 claim 都
// 会被 hash 比对失败拒绝），所以哪怕泄漏也不构成实际威胁。
func (h *PageHandlers) getInstance() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		owner, err := usecases.LoadSoleOwner(r.Context(), h.Page)
		if err != nil && !errors.Is(err, domain.ErrOwnerNotFound) {
			h.Log.Error("load sole owner", "err", err)
			writeError(h.Log, w, apierr.Envelope{
				Status:  http.StatusInternalServerError,
				Code:    "server_error",
				Message: "internal error",
			})
			return
		}
		writeInstanceInfo(h.Log, w, &owner, h.unclaimedSetupToken(r.Context(), &owner))
	}
}

// unclaimedSetupToken —— claimed 时返空串（不暴露 token）。unclaimed 时
// 经 usecase 拿一个一定可用的 plaintext（必要时 self-heal：当 DB hash 为
// NULL 或 holder 为空时重新 issue）。
func (h *PageHandlers) unclaimedSetupToken(ctx context.Context, owner *domain.Owner) string {
	if owner.ID != "" || h.TokenIssuer == nil {
		return ""
	}
	return h.ensureUnclaimedTokenOrLog(ctx)
}

func (h *PageHandlers) ensureUnclaimedTokenOrLog(ctx context.Context) string {
	plaintext, err := usecases.EnsureUnclaimedSetupToken(ctx, h.TokenIssuer)
	if err != nil {
		h.Log.Error("ensure unclaimed setup token", "err", err)
		return ""
	}
	return plaintext
}

func writeInstanceInfo(log *slog.Logger, w http.ResponseWriter, owner *domain.Owner, token string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	view := instanceInfoView{
		Claimed:    owner.ID != "",
		Handle:     owner.Handle,
		SetupToken: token,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode instance info", "err", err)
	}
}

type instanceInfoView struct {
	Handle     string `json:"handle"`
	SetupToken string `json:"setup_token,omitempty"`
	Claimed    bool   `json:"claimed"`
}

func (h *PageHandlers) getPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		view, err := usecases.GetPublicPage(r.Context(), h.Page)
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
	if errors.Is(err, domain.ErrOwnerNotFound) {
		return apierr.Envelope{
			Status:  http.StatusNotFound,
			Code:    "owner_not_found",
			Message: "instance not yet claimed",
		}
	}
	return apierr.Envelope{
		Status: http.StatusInternalServerError, Code: "server_error", Message: "internal error",
	}
}
