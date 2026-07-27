package middleware

import "net/http"

// PublicCORS —— 公开访客面 (/api/v1/*) 的 wide-open CORS。
//
// D.2:@standmeet/embed / @standmeet/sdk 从任意第三方站点的 origin 加载，浏览器
// 会对跨源的 session/chat/SSE 请求发 preflight。没有 CORS 头，浏览器直接把响应挡在
// JS 之外，embed 完全 bootstrap 不起来（真实验证 F-O-1:OPTIONS → 405，零 ACAO）。
//
// SDK 用 /sessions 返回的 Bearer token 认证（不靠 cookie，见 core client.ts），所以
// Allow-Origin: * 安全——不需要 credentials 模式，也就不用把 origin 收窄。
//
// 挂在 /api/v1 组的**最外层**（BanGuard/RateGuard 之前）:即便后面 403/429，浏览器也
// 得先能读到 ACAO 才能把真实状态码交给 embed，否则跨源失败会糊成一个 opaque CORS 错。
// OPTIONS preflight 在这里短路成 204（否则 chi 对只有 POST 的路由回 405）。
func PublicCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		h.Set("Access-Control-Max-Age", "600")
		h.Add("Vary", "Origin")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
