// monitor_routes_test.go —— every rule in monitor's table names a route that exists, and sits
// under a router that actually records.
//
// This is the guard for the defect that shipped: `/robots.txt` and `/sitemap.xml` were in the
// table, correct in every detail, and could never fire — the recording middleware was mounted
// only on `/api/v1`, and those two routes live at the root by SEO convention. A crawler fetched
// robots.txt, got 200, and nothing was written. Nothing failed, nothing was logged, and the
// rules read exactly like the rules that worked.
//
// A rule that can never fire is indistinguishable from a rule that works, from the inside. The
// only way to tell is to ask the real router.

package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/monitor/mw"
)

// TestMonitorRulesNameRealRoutes —— every pattern monitor claims to instrument resolves against
// the router the server actually builds.
func TestMonitorRulesNameRealRoutes(t *testing.T) {
	t.Parallel()
	registered := registeredPatterns(t)
	for _, pattern := range mw.Patterns() {
		if !matchesSome(pattern, registered) {
			t.Errorf("monitor rule %q names no registered route — it can never fire, and a rule "+
				"that never fires reads exactly like one that works", pattern)
		}
	}
}

// There is deliberately no second test here asking "is a recorder on this mount".
//
// One was written, and it could not fail. It compared monitor's table against a hand-written
// list of the mounts that carry the recorder — and when the root mount was deliberately removed
// to check the guard, the guard stayed green, because removing the mount does not touch the
// list. The list was the same claim that was already wrong.
//
// That question is answered by structure instead: recordedRoute in boot_http_public.go attaches
// a public surface and its recorder in one call, so mounting one without the other means not
// using the function. See its comment.

// registeredPatterns —— every route the real public router registers, with the API prefix
// stripped so the keys read in the same terms as monitor's table.
func registeredPatterns(t *testing.T) map[string]bool {
	t.Helper()
	// QUERY is outside chi's default method table; New() registers it before mounting and the
	// read-only tools route panics without it.
	chi.RegisterMethod("QUERY")
	r := chi.NewRouter()
	deps := &Deps{}
	// The handlers, not mountPublic: the guard stack it also installs needs a live Redis, and
	// what this test asks about is which patterns are registered, not what runs in front of
	// them. mountPublicHandlers is a separate function precisely so this is possible.
	r.Route(publicAPIPrefix, func(r chi.Router) { mountPublicHandlers(r, deps) })
	mountRootSEO(r, deps)

	out := map[string]bool{}
	if err := chi.Walk(r, collectInto(out)); err != nil {
		t.Fatalf("walk public router: %v", err)
	}
	return out
}

// collectInto —— a chi.Walk visitor that records "METHOD pattern", API prefix stripped.
func collectInto(out map[string]bool) chi.WalkFunc {
	return func(
		method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler,
	) error {
		trimmed := strings.TrimSuffix(strings.TrimPrefix(route, publicAPIPrefix), "/")
		out[method+" "+trimmed] = true
		return nil
	}
}

// matchesSome —— the table stores a pattern without a method; a route exists if any method
// registers it.
func matchesSome(pattern string, registered map[string]bool) bool {
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
		if registered[method+" "+pattern] {
			return true
		}
	}
	return false
}
