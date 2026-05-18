// tls_ask.go —— GET /internal/tls-ask?domain=foo.bar
//   200 → "ok"  允许 Caddy 为该 domain 自动签发证书
//   403 → 拒绝
//
// 用途：Caddy 配 `on_demand_tls` 时把 ask URL 指向这里。Caddy 在见到一个
// 没见过的 SNI / Host 时先 GET 这个 URL 确认是不是合法 owner domain，
// 是再走 ACME 签证书。无白名单 = 任何人解析自己 DNS 到 instance 就能逼着
// instance 申请证书，会被 Let's Encrypt rate limit。
//
// 实现：直接查 instance_settings.allowed_domains（jsonb 数组），命中
// 就 200，否则 403。allow list 在 admin 维护；setup 期默认把
// PUBLIC_URL 的 host 加进去。

package sys

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	smdomain "github.com/wangsijie/standmeet/internal/domain"
)

// AllowedDomainLookup —— instance_settings 表的窄接口。让 sys 不直接 import
// postgres struct 而走 interface（沿用 arch-lint 已允许的依赖图）。
type AllowedDomainLookup interface {
	IsDomainAllowed(ctx context.Context, host string) (bool, error)
}

// TLSAskDeps —— /internal/tls-ask 需要的依赖。
type TLSAskDeps struct {
	Log     *slog.Logger
	Domains AllowedDomainLookup
}

// MountTLSAsk 挂 /tls-ask 到 r（已经被父 router 加了 /internal 前缀）。
func MountTLSAsk(r chi.Router, deps TLSAskDeps) {
	r.Get("/tls-ask", tlsAsk(deps))
}

func tlsAsk(deps TLSAskDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		d := r.URL.Query().Get("domain")
		if d == "" {
			http.Error(w, "domain required", http.StatusBadRequest)
			return
		}
		ok, err := deps.Domains.IsDomainAllowed(r.Context(), d)
		writeAskResult(deps.Log, w, askOutcome{Domain: d, Allowed: ok, Err: err})
	}
}

// askOutcome —— 把 ok+err 打包给 writeAskResult，避免控制 flag-parameter。
type askOutcome struct {
	Err     error
	Domain  string
	Allowed bool
}

func writeAskResult(log *slog.Logger, w http.ResponseWriter, o askOutcome) {
	if isLookupErr(o.Err) {
		log.Error("tls-ask", "domain", o.Domain, "err", o.Err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeAllowedOrDeny(log, w, o)
}

func writeAllowedOrDeny(log *slog.Logger, w http.ResponseWriter, o askOutcome) {
	if !o.Allowed {
		log.Warn("tls-ask deny", "domain", o.Domain)
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	if _, err := w.Write([]byte("ok")); err != nil {
		log.Warn("tls-ask write", "err", err)
	}
}

func isLookupErr(err error) bool {
	return err != nil && !errors.Is(err, smdomain.ErrInstanceSettingsNotFound)
}
