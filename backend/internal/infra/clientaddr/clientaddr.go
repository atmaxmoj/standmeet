// Package clientaddr decides whether a request's source address is truly the visitor's
// own, and decides it exactly once.
//
// chi.RealIP resolves X-Forwarded-For / X-Real-IP into RemoteAddr. Without those headers,
// RemoteAddr stops at the **previous hop** — and the self-hosted default shape is exactly:
//
//	browser → app (Next's /api/:path* rewrite) → backend
//
// Nothing in between writes a forwarding header (`make prod-up` says "TLS/domain is
// external", the reverse proxy is the owner's own). So every visitor gets recorded as
// the same address: the app container itself.
//
// Taking that address at face value causes three problems, and none of them is cosmetic:
//   - owner's /admin/conversations has an IP column, and /admin/ip-bans tells them to
//     "Find offending IPs in conversations" — doing that bans every visitor;
//   - the per-IP access-code failure lockout becomes one **global bucket**: 10 wrong
//     tries by one person locks everyone out (including someone with a real code headed
//     to an interview) for 15 minutes;
//   - the owner's own login rate limiting shares that same bucket.
//
// So the rule here is: **either it's the visitor's address, or it's unknown.** When unsure,
// return an empty string and let downstream treat it as "unknown" (conversations.client_ip's
// contract already is "empty = unknown") — never pass off the intermediate hop as the visitor.
//
// The one time it can't be determined, we WARN once (once per process) and put both the
// consequence and the fix in the log — nobody has documented this fork before, and ops
// only ever finds deployment truth in the logs.
package clientaddr

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
)

type ctxKey struct{}

// forwardHeaders — the headers chi.RealIP recognizes. **Whether** these headers are present
// decides if RemoteAddr is the visitor's address or the previous hop's; this only checks
// presence, RealIP still owns parsing the value.
var forwardHeaders = []string{"X-Forwarded-For", "X-Real-IP", "True-Client-IP"}

// Middleware — runs after chi.RealIP: decides once whether the source address is the
// visitor's, and puts the verdict into context. The verdict is produced only here; every
// reader (session accounting / access-code lock / login rate limiting) gets the same answer.
func Middleware(log *slog.Logger) func(http.Handler) http.Handler {
	var once sync.Once
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			v := resolve(r)
			if v.worthWarning() {
				once.Do(func() { warnHidden(log, v.peer) })
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, v.addr)))
		})
	}
}

// Of — reads the verdict. Empty string = unknown (not 0.0.0.0, and not the previous hop's
// address). A request that never went through Middleware (built directly in a unit test)
// also returns empty: better unknown than impersonated.
func Of(ctx context.Context) string {
	addr, ok := ctx.Value(ctxKey{}).(string)
	if !ok {
		return ""
	}
	return addr
}

// verdict — the result of one determination. addr is the visitor's address (empty =
// unknown); peer is this hop's remote end (log-only, never treated as the visitor's address).
type verdict struct {
	addr   string
	peer   string
	hidden bool
}

// worthWarning — whether this instance should call out the deployment fork. Only calls it
// out for requests that **could be a visitor**: the container's own healthcheck goes over
// loopback with no forwarding header either, and would steal that "once per process"
// warning — with peer showing 127.0.0.1, correct content but the wrong subject, so ops
// would dismiss it as healthcheck noise.
func (v verdict) worthWarning() bool {
	if !v.hidden {
		return false
	}
	ip := net.ParseIP(hostOf(v.peer))
	return ip == nil || !ip.IsLoopback()
}

// resolve — three cases:
//
//	has forwarding header  → RealIP already resolved it, host is the visitor's address
//	private/loopback peer  → with no forwarding header that can only be my own side's
//	                          hop, treat as unknown
//	otherwise              → a public client connecting directly
func resolve(r *http.Request) verdict {
	host := hostOf(r.RemoteAddr)
	if forwarded(r) {
		return verdict{addr: host, peer: r.RemoteAddr}
	}
	if isInternalHop(host) {
		return verdict{peer: r.RemoteAddr, hidden: true}
	}
	return verdict{addr: host, peer: r.RemoteAddr}
}

func forwarded(r *http.Request) bool {
	for _, h := range forwardHeaders {
		if r.Header.Get(h) != "" {
			return true
		}
	}
	return false
}

func hostOf(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr // it was already a bare IP
	}
	return host
}

// isInternalHop — private / loopback / link-local. A public visitor can never arrive with
// this kind of source address, so this address class plus "no forwarding header" can only
// be this side's own hop.
func isInternalHop(host string) bool {
	ip := net.ParseIP(host)
	if ip == nil {
		return true // not even an address (e.g. a unix socket) — also not the visitor's address
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
}

// warnHidden — once per process. Spells out **what capability is lost**, and how to get
// it back.
func warnHidden(log *slog.Logger, remoteAddr string) {
	log.Warn("visitor IP not visible: no forwarding header on the proxy hop",
		"peer", remoteAddr,
		"effect", "conversations record no source IP; per-IP code lockout and login "+
			"rate limiting apply to everyone as one bucket; IP bans cannot target a visitor",
		"fix", "front this instance with a proxy that sets X-Forwarded-For")
}
