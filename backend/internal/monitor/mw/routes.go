// routes.go —— which public route means which recorded event.
//
// This table is the whole instrumentation plan, and it lives HERE, inside monitor. No other
// domain calls monitor, imports monitor, or knows monitor exists. A handler in corpus, chat or
// access is not edited to add a measurement, and cannot be edited to remove one.
//
// That is not tidiness. A per-call-site instrumentation plan is a hand-written list, and a
// hand-written list rots the first time a route moves — the same defect this design refuses for
// corpus slugs (docs/design/monitor.md §6), one level up. Here, a route that disappears leaves
// an entry that can never fire, and a guard test can see that. A call site deleted from another
// domain's handler leaves nothing at all to see.
//
// What the table cannot do is invent meaning. It reads a request's route pattern, method and
// response status. Anything that depends on state inside a handler is either derived from the
// response (an error code is in the envelope) or reported by the browser through the beacon.

package mw

import (
	"net/http"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
)

// rule —— one route pattern's meaning.
type rule struct {
	// Pattern —— the chi route pattern, exactly as the route was registered. Matched against
	// chi.RouteContext().RoutePattern(), so a wildcard route matches once, not per URL.
	Pattern string
	Method  string
	Surface entity.Surface
	// Event —— empty means this route records a view.
	Event string
	// Kind —— the corpus genre this route serves, when it serves one. The slug comes from the
	// URL; the immutable id comes from the resolver, because a slug is not an identity.
	Kind entity.Kind
	// SlugParam —— which chi URL param holds the slug. "*" is the wildcard.
	SlugParam string
	// OnlyOK —— record only when the handler answered 2xx. A 404 on a reader route is not a
	// read; counting it would put deleted entries on the "most read" list.
	OnlyOK bool
}

// rules —— the table. Ordered for reading, matched by exact pattern.
//
// The backend serves the data behind each public page, so one API hit is one page view. That is
// an approximation and it is stated rather than hidden: a reader who reloads twice counts twice,
// exactly as it would with a browser beacon.
var rules = []rule{
	// —— corpus reader. The entity rules; everything else is a page.
	{
		Pattern: "/wiki/*", Method: http.MethodGet, Surface: entity.SurfaceReader,
		Kind: entity.KindWiki, SlugParam: "*", OnlyOK: true,
	},
	{
		Pattern: "/output/*", Method: http.MethodGet, Surface: entity.SurfaceReader,
		Kind: entity.KindOutput, SlugParam: "*", OnlyOK: true,
	},
	{
		Pattern: "/writings/{slug}", Method: http.MethodGet, Surface: entity.SurfaceWritings,
		Kind: entity.KindWriting, SlugParam: "slug", OnlyOK: true,
	},
	{Pattern: "/writings", Method: http.MethodGet, Surface: entity.SurfaceWritings, OnlyOK: true},
	{
		Pattern: "/assets/{id}", Method: http.MethodGet, Surface: entity.SurfaceReader,
		Event: entity.EventAssetDownload, Kind: entity.KindAsset, SlugParam: "id", OnlyOK: true,
	},

	// —— microsites and the owner's homepage.
	{
		Pattern: "/microsites/{slug}", Method: http.MethodGet, Surface: entity.SurfaceMicrosite,
		Kind: entity.KindMicrosite, SlugParam: "slug", OnlyOK: true,
	},
	{
		Pattern: "/microsites/{slug}/*", Method: http.MethodGet, Surface: entity.SurfaceMicrosite,
		Kind: entity.KindMicrosite, SlugParam: "slug", OnlyOK: true,
	},
	// NOT here: /homepage. It looks like the owner's index page and is not one — the Next
	// middleware probes it on every request to `/` to decide whether a live home page exists,
	// then rewrites to it. Counting it recorded the app's own liveness check as a visitor, and
	// the panel showed eight views on an instance nobody had visited. The real "someone opened
	// the index" signal has to come from the browser (monitor.md §4.1), which the beacon will
	// carry; a server-side route cannot tell a reader from a plumbing probe.
	{
		Pattern: "/pages/{slug}/store", Method: http.MethodPost, Surface: entity.SurfaceMicrosite,
		Event: entity.EventStoreWrite, Kind: entity.KindMicrosite, SlugParam: "slug",
		OnlyOK: true,
	},

	// —— the gate. A code submission is recorded whatever the outcome: the ratio between
	// accepted and rejected is the signal, so recording only the wins would say nothing.
	{
		Pattern: "/codes/intro", Method: http.MethodPost, Surface: entity.SurfaceGate,
		Event: entity.EventCodeSubmit,
	},
	{
		Pattern: "/access-requests", Method: http.MethodPost, Surface: entity.SurfaceGate,
		Event: entity.EventAccessRequest, OnlyOK: true,
	},

	// —— visitor chat.
	{
		Pattern: "/sessions", Method: http.MethodPost, Surface: entity.SurfaceChat,
		Event: entity.EventChatSessionStart, OnlyOK: true,
	},
	{
		Pattern: "/agent/turn", Method: http.MethodPost, Surface: entity.SurfaceChat,
		Event: entity.EventChatTurnSent,
	},
	{
		Pattern: "/llm/chat/stream", Method: http.MethodPost, Surface: entity.SurfaceChat,
		Event: entity.EventChatTurnSent,
	},
	{
		Pattern: "/sessions/{id}/tools/{tool_name}", Method: http.MethodPost,
		Surface: entity.SurfaceChat, Event: entity.EventToolCall,
	},
	{
		Pattern: "/sessions/{id}/ghosts/shown", Method: http.MethodPost,
		Surface: entity.SurfaceChat, Event: entity.EventGhostShown, OnlyOK: true,
	},
	{
		Pattern: "/sessions/{id}/ghosts/{sid}/accept", Method: http.MethodPost,
		Surface: entity.SurfaceChat, Event: entity.EventGhostAccepted, OnlyOK: true,
	},
	{
		Pattern: "/report/{id}", Method: http.MethodGet, Surface: entity.SurfaceChat,
		Event: entity.EventReportOpen, OnlyOK: true,
	},
	{
		Pattern: "/report/{id}/pdf", Method: http.MethodGet, Surface: entity.SurfaceChat,
		Event: entity.EventReportPDF, OnlyOK: true,
	},

	// —— crawlers. Recorded as bots, and the panel names which one. For a product whose thesis
	// is that an AI answers in the owner's voice, "ClaudeBot read the corpus" is product
	// information, not infrastructure trivia.
	{
		Pattern: "/robots.txt", Method: http.MethodGet, Surface: entity.SurfaceSEO,
		Event: entity.EventRobotsFetch,
	},
	{
		Pattern: "/sitemap.xml", Method: http.MethodGet, Surface: entity.SurfaceSEO,
		Event: entity.EventSitemapFetch,
	},
}

// index —— pattern+method to rule, built once.
var index = buildIndex()

func buildIndex() map[string]*rule {
	m := make(map[string]*rule, len(rules))
	for i := range rules {
		m[key(rules[i].Method, rules[i].Pattern)] = &rules[i]
	}
	return m
}

func key(method, pattern string) string { return method + " " + pattern }

// lookup —— the rule for a route pattern, or nil when this route is not worth recording.
//
// Not-in-the-table is the default, and it is the right default. The public API is mostly
// chatter a page makes while rendering — instance metadata, appearance CSS, prompt text, tree
// context — and recording it would bury the twenty rows an owner actually reads under
// thousands they never asked about.
func lookup(method, pattern string) *rule {
	if pattern == "" {
		return nil
	}
	return index[key(method, strings.TrimSuffix(pattern, "/"))]
}

// Patterns —— every route pattern this table claims to instrument. A guard test walks the
// registered public routes and asserts each of these still exists; an entry that matches no
// route can never fire, and a rule that can never fire is indistinguishable from no rule.
func Patterns() []string {
	out := make([]string, 0, len(rules))
	for i := range rules {
		out = append(out, rules[i].Pattern)
	}
	return out
}
