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

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// PageHandlers —— page route 依赖。
type PageHandlers struct {
	Page        owner.PageDeps
	Log         *slog.Logger
	TokenIssuer owner.SetupTokenIssuer // 仅 unclaimed 时调；handler 通过它取 / self-heal plaintext
	// Outbound —— owner 有没有可用的出站通道,决定 gate 是否
	// 展示「request access」整块(发不出码就别展示)。
	Outbound owner.OutboundStatusDeps
	// CaptchaSiteKey —— /api/v1/instance 把这个 echo 给前端；前端非空就渲染
	// Turnstile widget。composition root 已经从 env 决定了"开/关"，这里
	// 只读结果。空字符串表示 captcha 关闭。
	CaptchaSiteKey string
}

// Mount 挂 /page + /instance + /appearance.css。caller 负责前缀（/api/v1）。
func (h *PageHandlers) Mount(r chi.Router) {
	r.Get("/page", h.getPage())
	r.Get("/instance", h.getInstance())
	r.Get("/appearance.css", h.getAppearanceCSS())
}

// getAppearanceCSS —— GET /api/v1/appearance.css:sole owner 的自定义 CSS 作为真正的
// stylesheet 资源(text/css)返回,reader 页 <link> 它。后端已 sanitize + scope 到
// .corpus-content;无 owner / 未设 → 空表(无副作用)。
func (h *PageHandlers) getAppearanceCSS() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		css := ""
		if soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page); err == nil {
			css = h.ownerCustomCSS(r.Context(), soleOwner.ID)
		}
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		if _, werr := w.Write([]byte(css)); werr != nil {
			h.Log.Error("write appearance css", logErrKey, werr)
		}
	}
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
		soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
		if err != nil && !errors.Is(err, owner.ErrOwnerNotFound) {
			h.Log.Error("load sole owner", logErrKey, err)
			writeError(h.Log, w, apierr.Envelope{
				Status:  http.StatusInternalServerError,
				Code:    "server_error",
				Message: "internal error",
			})
			return
		}
		writeInstanceInfo(h.Log, w, &instanceWriteInput{
			owner:          &soleOwner,
			setupToken:     h.unclaimedSetupToken(r.Context(), &soleOwner),
			captchaSiteKey: h.CaptchaSiteKey,
			canEmailCodes:  owner.CanDeliverCodes(r.Context(), h.Outbound, soleOwner.ID),
		})
	}
}

// unclaimedSetupToken —— claimed 时返空串（不暴露 token）。unclaimed 时
// 经 usecase 拿一个一定可用的 plaintext（必要时 self-heal：当 DB hash 为
// NULL 或 holder 为空时重新 issue）。
func (h *PageHandlers) unclaimedSetupToken(ctx context.Context, o *owner.Owner) string {
	if o.ID != "" || h.TokenIssuer == nil {
		return ""
	}
	return h.ensureUnclaimedTokenOrLog(ctx)
}

func (h *PageHandlers) ensureUnclaimedTokenOrLog(ctx context.Context) string {
	plaintext, err := owner.EnsureUnclaimedSetupToken(ctx, h.TokenIssuer)
	if err != nil {
		h.Log.Error("ensure unclaimed setup token", logErrKey, err)
		return ""
	}
	return plaintext
}

// ownerCustomCSS —— 已 claim 的 owner 的自定义 CSS(best-effort;未 claim / 错 → 空)。
func (h *PageHandlers) ownerCustomCSS(ctx context.Context, ownerID string) string {
	if ownerID == "" {
		return ""
	}
	css, err := h.Page.Owners.GetCSS(ctx, ownerID)
	if err != nil {
		return ""
	}
	return css
}

// instanceWriteInput —— writeInstanceInfo 的入参打包。
type instanceWriteInput struct {
	owner          *owner.Owner
	setupToken     string
	captchaSiteKey string
	canEmailCodes  bool
}

func writeInstanceInfo(log *slog.Logger, w http.ResponseWriter, in *instanceWriteInput) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	view := instanceInfoView{
		Claimed:         in.owner.ID != "",
		Handle:          in.owner.Handle,
		Name:            in.owner.FullName,
		SetupToken:      in.setupToken,
		CaptchaSiteKey:  in.captchaSiteKey,
		CanDeliverCodes: in.canEmailCodes,
	}
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode instance info", logErrKey, err)
	}
}

type instanceInfoView struct {
	Handle          string `json:"handle"`
	Name            string `json:"name"`
	SetupToken      string `json:"setup_token,omitempty"`
	CaptchaSiteKey  string `json:"captcha_site_key,omitempty"`
	Claimed         bool   `json:"claimed"`
	CanDeliverCodes bool   `json:"can_deliver_codes"`
}

func (h *PageHandlers) getPage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		view, err := owner.GetPublicPage(r.Context(), h.Page)
		if err != nil {
			handlePageErr(h.Log, w, err)
			return
		}
		writePageView(h.Log, w, &view)
	}
}

func writePageView(log *slog.Logger, w http.ResponseWriter, view *owner.PublicPageView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(view); err != nil {
		log.Error("encode page view", logErrKey, err)
	}
}

func handlePageErr(log *slog.Logger, w http.ResponseWriter, err error) {
	env := classifyPageErr(err)
	if env.Status >= http.StatusInternalServerError {
		log.Error("page route", logErrKey, err)
	}
	writeError(log, w, env)
}

func classifyPageErr(err error) apierr.Envelope {
	if errors.Is(err, owner.ErrOwnerNotFound) {
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
