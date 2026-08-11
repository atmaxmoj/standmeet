package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
)

// BanChecker —— BanGuard 对封禁表的只读视图。用接口而非直接依赖 postgres，
// 避免 middleware 组件越界依赖 repo（arch-lint）；security.BannedIPRepo 满足它。
type BanChecker interface {
	IsBannedAnywhere(ctx context.Context, ip string) (bool, error)
}

// BanGuard —— 公开面封禁 enforcement middleware。命中 banned_ips 的来源 IP 一律
// 403 挡掉（visitor chat / session / access-request 全拒）。挂在 /api/v1 组上。
//
// checker 故障 fail-open（记 warn 放行）：跟 PublicRateGuard 一致，公开访客面
// 可用性优先，不让一次 DB 抖动把整个站点对所有人锁死。
//
// checker 必填；nil 直接 panic（composition root bug）。
func BanGuard(checker BanChecker) func(http.Handler) http.Handler {
	if checker == nil {
		panic("BanGuard: checker is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveBanGuard(w, r, checker, next)
		})
	}
}

func serveBanGuard(
	w http.ResponseWriter, r *http.Request, checker BanChecker, next http.Handler,
) {
	// 封禁按定义是**针对一个地址**的。地址不可见时（没有转发头的出厂形态，见 clientaddr）
	// 就没有可封的对象 —— 直接放行，而不是拿限流用的那个共用桶名去 banned_ips 里查一个
	// 假地址：那既永远查不中，又让 owner 有机会把那个字面量填进封禁表把所有人挡在门外。
	ip := clientaddr.Of(r.Context())
	if ip == "" {
		next.ServeHTTP(w, r)
		return
	}
	banned, err := checker.IsBannedAnywhere(r.Context(), ip)
	if err != nil {
		slog.Default().Warn("ban check failed, allowing", "err", err, "ip", ip)
		next.ServeHTTP(w, r)
		return
	}
	if banned {
		slog.Default().Warn("banned ip blocked", "ip", ip, "path", r.URL.Path)
		writeRateError(
			w, http.StatusForbidden, "ip_banned",
			"access from your network has been blocked",
		)
		return
	}
	next.ServeHTTP(w, r)
}
