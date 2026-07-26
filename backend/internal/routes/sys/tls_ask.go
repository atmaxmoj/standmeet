// tls_ask.go —— GET /internal/tls-ask?domain=foo.bar
//   200 → "ok"  这个 owner 自定义域名放行(反代可为它签证书)
//   403 → 拒绝
//
// **边界**：本 app 只拥有「哪些域名放行」这半边(owner 在 admin 维护 allow-list)。真正签证书
// (ACME / Let's Encrypt)是**部署 provider 的反代**的事 —— prod-deploy 是 provider 的活
// (roadmap: prod-deploy dropped),app 不跑反代、不做 Caddy。任何支持 on-demand-TLS 的反代
// (Caddy / Traefik / …)见到没见过的 Host 时 GET 这个 URL 确认合法 owner 域名,是才去签;
// 无白名单 = 谁把 DNS 指过来都能逼实例申证书 → 撞 rate limit。
//
// 实现：查 instance_settings.allowed_domains(jsonb 数组),命中 200 否则 403。
// setup 期默认把 PUBLIC_URL 的 host 加进去。

package sys

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/instancedomain"
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
	return err != nil && !errors.Is(err, instancedomain.ErrInstanceSettingsNotFound)
}
