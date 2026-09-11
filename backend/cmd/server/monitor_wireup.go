// monitor_wireup.go —— assembles the monitor domain and its one mounting point.
//
// The whole of monitor's contact with the rest of the instance is here: a repo over the shared
// pool, four small functions it declared as ports, and a chi middleware that boot_http mounts on
// the public router. Nothing in corpus, chat, access or owner is edited, and no handler
// anywhere calls monitor (docs/design/monitor.md §0).

package main

import (
	"context"
	"crypto/sha256"
	"net/http"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	monitor "github.com/atmaxmoj/standmeet/internal/monitor/facade"
	"github.com/atmaxmoj/standmeet/internal/monitor/mw"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// buildMonitor —— the recording middleware's configuration.
func buildMonitor(d *deps.Runtime) mw.Config {
	seo := seoDepsFor(d)
	return mw.Config{
		Deps: &monitor.Deps{
			Repo:           d.MonitorRepo,
			Log:            d.Log,
			Secret:         monitorSalt(d.StorageSecretKey),
			OwnerID:        soleOwnerID(seo),
			Enabled:        collectionEnabled(d),
			IsOwnerRequest: ownerBrowserPresent(),
			Geo:            loadGeoResolver(d.Log),
		},
		Resolver: &monitorResolver{seo: seo, codes: d.CodeRepo},
	}
}

// monitorSalt —— the secret that salts the viewer hash.
//
// Derived from STORAGE_SECRET_KEY rather than read from a knob of its own. The derivation is
// one-way, so the storage credential cannot be recovered from anything monitor stores, and the
// salt is stable across restarts — which it must be, or every restart would turn every
// returning visitor into a new one. A knob of its own would be one more required secret for a
// self-hosting owner to generate and never think about again.
func monitorSalt(storageSecret string) []byte {
	sum := sha256.Sum256([]byte("standmeet/monitor/viewer-salt\x00" + storageSecret))
	return sum[:]
}

// soleOwnerID —— which owner this instance serves. v1 is single-owner; the signature takes a
// context so multi-tenant costs nothing later.
func soleOwnerID(seo owner.SEODeps) func(context.Context) (string, error) {
	return func(ctx context.Context) (string, error) {
		row, ok := owner.FirstOwner(ctx, seo)
		if !ok {
			// An unclaimed instance has no owner to attribute traffic to. Not an error: a
			// fresh install serves its setup page and records nothing.
			return "", nil
		}
		return row.ID, nil
	}
}

// collectionEnabled —— the owner's collection switch (monitor.md §8).
//
// Reads the sole owner's monitoring_enabled column per request, so flipping the toggle takes
// effect on the very next visitor with no restart. Fail-open: a read error (or an unclaimed
// instance) keeps collecting — instrumentation must never take the instance down, and the repo
// already returns true for "no owner row yet". The owner turning it OFF is the only thing that
// stops the recorder.
func collectionEnabled(d *deps.Runtime) func(context.Context) bool {
	return func(ctx context.Context) bool {
		enabled, err := d.OwnerRepo.SoleMonitoringEnabled(ctx)
		if err != nil {
			d.Log.Warn("read monitoring switch", "err", err)
			return true
		}
		return enabled
	}
}

// ownerBrowserPresent —— is this request coming from the browser the owner is signed in on.
//
// It reads the CSRF cookie, not the session cookie, and that is not a shortcut. The session
// cookie is `Path=/api/admin` (routes/admin/auth.go), so it is **never sent to /api/v1** — a
// check against it on the public surface can never fire, and an exclusion that can never fire
// is worse than none: it reads as protection while the owner's own reading inflates every
// number they look at. That is exactly how this was written the first time, and the panel
// showed eight views on an instance nobody had visited.
//
// The CSRF cookie is `Path=/`, issued at login and cleared at sign-out, so it does reach here.
// Using it costs nothing in security: it is a double-submit token that grants nothing on its
// own, and the worst a forger achieves is excluding themselves from the owner's statistics.
func ownerBrowserPresent() func(*http.Request) bool {
	return func(r *http.Request) bool {
		cookie, err := r.Cookie(authmw.CSRFCookieName)
		return err == nil && cookie.Value != ""
	}
}

// seoDepsFor —— the corpus read handles the resolver needs, in the shape owner already declares
// for its landing pages. Reused rather than redeclared so a change to that shape reaches here.
func seoDepsFor(d *deps.Runtime) owner.SEODeps {
	return owner.SEODeps{
		Owners: d.OwnerRepo,
		Wiki:   d.WikiRepo,
		Output: d.OutputRepo,
	}
}
