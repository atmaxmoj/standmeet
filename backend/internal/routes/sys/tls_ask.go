// tls_ask.go —— GET /internal/tls-ask?domain=foo.bar
//   200 -> "ok"  this owner custom domain is allowed (the reverse proxy may sign a cert
//                for it)
//   403 -> denied
//
// **Boundary**: this app owns only the "which domains are allowed" half (the owner
// maintains the allow-list in admin). Actually signing the cert (ACME / Let's Encrypt) is
// the job of the **deploy provider's reverse proxy** — prod-deploy is the provider's job
// (roadmap: prod-deploy dropped), this app doesn't run a reverse proxy or Caddy. Any
// reverse proxy that supports on-demand TLS (Caddy / Traefik / ...) GETs this URL to
// confirm a legitimate owner domain when it sees an unfamiliar Host, and only signs if
// confirmed; no allow-list means anyone who points DNS here can force the instance to
// request a cert -> hits rate limits.
//
// Implementation: looks up instance_settings.allowed_domains (a jsonb array), 200 on a
// hit, 403 otherwise. Setup adds the PUBLIC_URL host to it by default.

package sys

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/go-chi/chi/v5"
)

// AllowedDomainLookup —— a narrow interface over the instance_settings table. Lets sys
// go through an interface instead of importing the postgres struct directly (following
// the dependency graph arch-lint already allows).
type AllowedDomainLookup interface {
	IsDomainAllowed(ctx context.Context, host string) (bool, error)
}

// TLSAskDeps —— the dependency /internal/tls-ask needs.
type TLSAskDeps struct {
	Log     *slog.Logger
	Domains AllowedDomainLookup
}

// MountTLSAsk mounts /tls-ask onto r (the parent router has already added the /internal
// prefix).
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

// askOutcome —— bundles ok+err for writeAskResult, avoiding a control flag-parameter.
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
	return err != nil && !errors.Is(err, owner.ErrInstanceSettingsNotFound)
}
