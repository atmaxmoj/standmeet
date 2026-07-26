// connectors_authorize.go —— oauth2 dance 的回程入口（callback）。dance 本身由前端 window.location
// 跳到 provider（POST /connect 返回的 auth_url），provider 同意后带 code+state 回这里换 token。
// dance 是浏览器导航，错误不能回 JSON 错误页（会把原始报文晾给 owner），一律 302 回 connectors 区
// （常量目标，避免把 provider 的 auth_url 或 path 参数喂进 Location 头）；失败带 connect_error=1，
// 前端据 sessionStorage 记的「正在连哪个」把友好错误落到对应卡片。

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// connectorOAuthCallback —— provider 带 code+state 回程 → 换 token。provider 拒绝（?error=）/ state
// 不符 / 换 token 失败 → 302 回 connectors 区带 connect_error=1。
func (h *Handlers) connectorOAuthCallback() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("error") != "" {
			http.Redirect(w, r, "/admin/connectors?connect_error=1", http.StatusFound)
			return
		}
		err := h.ConnectorsAdmin.Svc.Callback(
			r.Context(), chi.URLParam(r, paramID),
			r.URL.Query().Get("code"), r.URL.Query().Get("state"),
		)
		if err != nil {
			// 回程一律 302（不把报文晾给 owner），但失败要留痕——否则 Redis/token 端基建故障
			// 会跟「用户重放了个过期 state」一样无声，运维查无可查。
			h.Log.Warn("connector oauth callback", logErrKey, err)
			http.Redirect(w, r, "/admin/connectors?connect_error=1", http.StatusFound)
			return
		}
		http.Redirect(w, r, "/admin/connectors", http.StatusFound)
	}
}
