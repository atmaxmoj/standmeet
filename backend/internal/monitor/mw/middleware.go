// middleware.go —— the one place traffic is recorded on the server.
//
// Mounted once, on the public router, at the composition root. It observes; it is never called.
// Every other domain stays exactly as it was, and a measurement cannot be lost by someone
// editing a handler that never mentioned measurement in the first place.
//
// What it can see: the route pattern, the method, the URL, the request headers, and the
// response status. That is enough for a view, an entity, a code, a crawler and an outcome.
// What it cannot see is state that never leaves a handler — and rather than reach in for it,
// the browser reports those through the beacon (docs/design/monitor.md §4).

package mw

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
	"github.com/atmaxmoj/standmeet/internal/monitor/ops"
)

// Resolver —— how monitor turns what a URL carries into what a row must store.
//
// Declared here and implemented at the composition root, so monitor depends on no other domain
// and no other domain depends on monitor. A slug is not an identity: it can be renamed and
// reparented, and an aggregate keyed on one splits an entry's history in two (monitor.md §6
// rule 1). This port is what buys the immutable id.
//
// Both methods must be cheap and must tolerate a miss. A miss is normal — the slug may be for
// something that has just been deleted — and it is never an error worth surfacing.
type Resolver interface {
	// Entity —— a slug becomes the entry it names. An empty ID means unknown, and the event is
	// then recorded against its path alone: it still counts as a visit, but it cannot be
	// grouped with that entry's other reads.
	Entity(ctx context.Context, kind entity.Kind, slug string) entity.Entity
	// Code —— an access code's token becomes the code it names. The label is snapshotted onto
	// the row so a code the owner later revokes still reads as itself in the panel.
	Code(ctx context.Context, token string) CodeRef
}

// CodeRef —— an access code, as a row records it. A struct rather than two bare strings: two
// results of the same type are a standing invitation to swap them at one call site and never
// notice, because both spellings compile and both look right.
type CodeRef struct {
	ID    string
	Label string
}

// Config —— what the middleware needs. A nil Deps or Resolver disables recording rather than
// panicking: instrumentation must never be the thing that takes an instance down.
type Config struct {
	Deps     *ops.Deps
	Resolver Resolver
}

// Record —— chi middleware. Wrap a public router with it.
//
// `prefix` is where that router is mounted, e.g. "/api/v1", or "" at the root. chi's
// RoutePattern() returns the pattern composed through every nested router, so a route
// registered as "/writings" inside r.Route("/api/v1", …) reports as "/api/v1/writings", while
// "/robots.txt" at the root reports as itself. The table in routes.go is written in the routes'
// own terms, so the mount point is supplied here rather than repeated forty times in the table.
//
// It is an argument and not a config field because there is more than one mount: the visitor
// API sits under a prefix, and robots.txt and sitemap.xml sit at the root by SEO convention. A
// single shared field meant whichever mount was configured second silently won, and the crawler
// rules — the whole reason this domain records bots at all — never fired.
func Record(cfg *Config, prefix string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cfg == nil || cfg.Deps == nil {
				next.ServeHTTP(w, r)
				return
			}
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			cfg.after(r, rec.status, prefix)
		})
	}
}

// after —— runs once the handler has answered, so the outcome is known.
//
// Deliberately synchronous and deliberately last. Synchronous because a goroutine would outlive
// the request context and record against a cancelled one; last because the visitor already has
// their response by now, so the work here cannot slow down anything they are waiting for.
func (c *Config) after(r *http.Request, status int, prefix string) {
	pattern := strings.TrimPrefix(routePattern(r), prefix)
	rule := lookup(r.Method, pattern)
	if rule == nil {
		// Most public routes are chatter a page makes while rendering, so no-rule is the
		// common case and belongs at Debug.
		c.debugNoRule(pattern, r.Method)
		return
	}
	if rule.OnlyOK && (status < http.StatusOK || status >= http.StatusMultipleChoices) {
		// A 404 on a reader route is not a read. Counting it would put entries that no longer
		// exist onto the "most read" list.
		return
	}
	in := ops.Input{
		Surface: rule.Surface, Name: rule.Event, Props: outcomeProps(status),
		// The recorded path is the visitor's page, not the API route behind it. Without the
		// strip the panel lists "/api/v1/wiki/x" — a path no visitor ever typed and no owner
		// recognises, and one that also cannot be clicked through to the page it stands for.
		URL: strings.TrimPrefix(requestURI(r), prefix),
	}
	c.fillEntity(r, rule, &in)
	c.fillCode(r, &in)
	ops.RecordRequest(r.Context(), c.Deps, r, &in)
}

// fillEntity —— the immutable id behind the slug in the URL.
func (c *Config) fillEntity(r *http.Request, rule *rule, in *ops.Input) {
	if rule.Kind == "" || rule.SlugParam == "" || c.Resolver == nil {
		return
	}
	slug := chi.URLParam(r, rule.SlugParam)
	if slug == "" {
		return
	}
	found := c.Resolver.Entity(r.Context(), rule.Kind, slug)
	found.Kind = rule.Kind
	in.Entity = found
}

// fillCode —— which access code this visitor is travelling on.
//
// The token itself never reaches a row: it is exchanged here for an id and a label, and both
// the query parameter and the bearer header are dropped on the floor afterwards.
func (c *Config) fillCode(r *http.Request, in *ops.Input) {
	if c.Resolver == nil {
		return
	}
	token := codeToken(r)
	if token == "" {
		return
	}
	code := c.Resolver.Code(r.Context(), token)
	in.CodeID, in.CodeLabel = code.ID, code.Label
}

// outcomeProps —— what happened, as a label rather than a number. An owner reads "denied", not
// "403", and a status class is stable across the exact code a handler happens to pick.
func outcomeProps(status int) map[string]string {
	return map[string]string{"outcome": outcome(status)}
}

// exactOutcomes —— the statuses whose meaning to an owner is not their class. A 403 on a tool
// call is "denied", which is a fact about their access rules, not a server fault.
var exactOutcomes = map[int]string{
	http.StatusTooManyRequests: "throttled",
	http.StatusUnauthorized:    "denied",
	http.StatusForbidden:       "denied",
	http.StatusNotFound:        "missing",
}

func outcome(status int) string {
	if o, ok := exactOutcomes[status]; ok {
		return o
	}
	if status >= http.StatusInternalServerError {
		return "error"
	}
	if status >= http.StatusBadRequest {
		return "rejected"
	}
	return "ok"
}

// requestURI —— path plus query, or empty when the request carries no URL.
func requestURI(r *http.Request) string {
	if r.URL == nil {
		return ""
	}
	return r.URL.RequestURI()
}

// debugNoRule —— logging that survives to production, on a path that fails silently.
//
// A table whose keys stop matching records nothing and says nothing: the panel simply goes
// empty. This is the line that tells an operator which pattern arrived instead.
func (c *Config) debugNoRule(pattern, method string) {
	if c.Deps == nil || c.Deps.Log == nil {
		return
	}
	c.Deps.Log.Debug("monitor: no rule for route", "pattern", pattern, "method", method)
}

// routePattern —— the registered pattern, not the concrete URL. One wildcard route reports one
// pattern however many URLs it serves, which is what lets the table stay a fixed size.
func routePattern(r *http.Request) string {
	rctx := chi.RouteContext(r.Context())
	if rctx == nil {
		return ""
	}
	return rctx.RoutePattern()
}

// codeToken —— the access code carried on this request, from the query string or the bearer
// header. Returned to fillCode and never stored.
func codeToken(r *http.Request) string {
	if t := r.URL.Query().Get("code"); t != "" {
		return t
	}
	const bearer = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) > len(bearer) && h[:len(bearer)] == bearer {
		return h[len(bearer):]
	}
	return ""
}

// statusRecorder —— remembers the status a handler wrote. Nothing else is captured: the body is
// never read, so a response carrying a visitor's answer text cannot leak into a traffic row.
type statusRecorder struct {
	http.ResponseWriter

	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
