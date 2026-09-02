package middleware

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
)

// BanChecker is BanGuard's read-only view of the ban table. It's an
// interface rather than a direct postgres dependency, so the middleware
// component doesn't overreach into a repo dependency (arch-lint);
// security.BannedIPRepo satisfies it.
type BanChecker interface {
	IsBannedAnywhere(ctx context.Context, ip string) (bool, error)
}

// BanGuard is the public-facing ban enforcement middleware. A source IP
// that hits banned_ips is blocked with 403 across the board (visitor chat /
// session / access-request all denied). Mounted on the /api/v1 group.
//
// checker failures fail open (logged as warn, then allowed): matching
// PublicRateGuard, the public visitor surface prioritizes availability —
// one DB hiccup shouldn't lock the whole site out for everyone.
//
// checker is required; nil panics immediately (a composition root bug).
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
	// A ban is by definition **against an address**. When the address isn't
	// visible (no forwarded header, the out-of-the-box shape — see
	// clientaddr) there's nothing to ban — just allow it, rather than
	// looking up the shared bucket name used for rate-limiting against a
	// fake address in banned_ips: that lookup would never hit, and it would
	// give the owner a chance to put that literal string into the ban table
	// and lock everyone out.
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
