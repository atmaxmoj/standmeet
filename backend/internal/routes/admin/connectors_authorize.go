// connectors_authorize.go —— oauth2 连接器的「同标签发起 dance」入口（GET，CSRF 豁免）。admin UI 的
// Connect 按钮对 oauth2 直接 window.location 到这里：服务端起 dance → 302 跳到 provider 同意页 →
// 同意后 provider 回 callback 换 token → 再 302 回 /admin/connectors。整条是一次浏览器导航，所以
// 测试的 waitForURL 能真正等到回程（不像 XHR + JS 跳转那样有 async 缝隙）。凭据 owner 已在表单里
// 即时存好（卡片字段改动即存），故这里只读已存凭据起 dance。

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/middleware"
)

// connectorAuthorize —— 起 oauth2 dance（或非 dance 连接器直接连）。成功 → 302 到 auth_url（或回
// connectors 区）；失败 → 回 connectors 区带错误标记（卡片据此显示友好错误）。
func (h *Handlers) connectorAuthorize() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		res, err := h.ConnectorsAdmin.Svc.Connect(r.Context(), ownerID, chi.URLParam(r, paramID))
		if err != nil {
			http.Redirect(w, r, "/admin/connectors?connect_error=1", http.StatusFound)
			return
		}
		http.Redirect(w, r, authorizeTarget(res.AuthURL), http.StatusFound)
	}
}

// authorizeTarget —— 有 auth_url（oauth2 dance）→ 跳同意页；否则（非 dance 已连）→ 回 connectors 区。
func authorizeTarget(authURL string) string {
	if authURL != "" {
		return authURL
	}
	return "/admin/connectors"
}
