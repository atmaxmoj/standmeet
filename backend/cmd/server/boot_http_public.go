// boot_http_public.go —— the public (visitor-facing) router: /api/v1 plus the two root SEO
// paths. Split out of boot_http.go, which reached its line cap; one concern per file, and the
// public surface is a concern of its own — it is the only router with no authentication in
// front of it, so what guards it is worth reading in one screen.

package main

import (
	"github.com/go-chi/chi/v5"

	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	monitormw "github.com/atmaxmoj/standmeet/internal/monitor/mw"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
)

// publicAPIPrefix —— where the visitor-facing API is mounted. Named because two things must
// agree on it: the r.Route below, and monitor's middleware, which has to strip it off the
// pattern chi reports before matching its own route table.
const publicAPIPrefix = "/api/v1"

func mountPublic(r chi.Router, deps *Deps) {
	// Mount the Handlers value wireup already built directly, instead of re-copying
	// each field one by one (G-1.5 smell E: a field was once added to Handlers,
	// wireup updated, but the mount site missed the copy → silent nil ran for a while).
	// #169 access-code redemption failure lockout: middleware wiring belongs to the
	// server layer (cmd doesn't import middleware), assembled alongside LoginGuard.
	// Injected into the public Handlers' narrow CodeGuard interface.
	deps.Public.CodeGuard = authmw.NewCodeGuard(
		deps.Redis, deps.CaptchaVerifier, deps.CaptchaEnabled,
	)
	// The gate on the message-request port (F-G-4): same assembly site, same parts,
	// just counting a different thing — that one counts wrong-guessed codes, this
	// one counts submitted messages. Without it, the queue the owner reads by hand
	// would only have a fail-open rate limit in front of it.
	deps.PublicAccessRequests.Guard = authmw.NewRequestGuard(
		deps.Redis, deps.CaptchaVerifier, deps.CaptchaEnabled,
	)
	recordedRoute(r, deps, publicAPIPrefix, func(r chi.Router) {
		mountPublicGuards(r, deps)
		mountPublicHandlers(r, deps)
	})
}

// recordedRoute —— mount a public surface at `prefix`, with traffic recording on it.
//
// The only way public routes get mounted. It exists because the alternative — remembering to add
// the middleware at each mount — was got wrong the first time: /robots.txt and /sitemap.xml were
// mounted at the root with no recorder, so the two crawler rules sat in monitor's table and
// never fired once. Nothing failed; a fetch just returned 200 and wrote nothing.
//
// A test could not fix that. Anything checking "is there a recorder on this mount" has to be
// told where the mounts are, and the list it is told is the same thing that was already wrong.
// So the mistake is removed instead of detected: a public surface and its recorder are attached
// by the same call, and adding one without the other means not using this function at all.
func recordedRoute(r chi.Router, deps *Deps, prefix string, mount func(chi.Router)) {
	inner := func(r chi.Router) {
		r.Use(monitormw.Record(&deps.Monitor, prefix))
		mount(r)
	}
	if prefix == "" {
		r.Group(inner)
		return
	}
	r.Route(prefix, inner)
}

// mountPublicGuards —— everything that runs before a public handler, in the order it runs.
func mountPublicGuards(r chi.Router, deps *Deps) {
	// CORS at the outermost layer: embeds load cross-origin from any origin, so
	// preflight + the ACAO header must be mounted before Ban/Rate (even a later
	// 403/429 still needs to be readable by cross-origin JS). D.2 wide-open.
	r.Use(authmw.PublicCORS)
	// Block banned IPs first (403), then per-IP rate-limit the public abuse
	// surface (429).
	r.Use(authmw.BanGuard(deps.BannedIPs))
	r.Use(authmw.PublicRateGuard(deps.Redis))
}

func mountPublicHandlers(r chi.Router, deps *Deps) {
	// The browser's half of the instrumentation. Mounted from monitor's own package, next to
	// the middleware, for the same reason: monitor is wired here and called from nowhere.
	r.Post("/t", monitormw.Beacon(&deps.Monitor))
	(&deps.Public).Mount(r)
	(&deps.PublicPage).Mount(r)
	(&deps.PublicSEO).Mount(r)
	(&deps.PublicMicrosites).Mount(r)
	// visitor read/write of a page's own document store
	(&deps.PublicMicrositeStore).Mount(r)
	(&deps.PublicMicrositePreview).Mount(r) // preview: public-side but token-gated
	(&deps.PublicAccessRequests).Mount(r)
	(&deps.PublicPasswordReset).Mount(r)
	(&deps.PublicWritings).Mount(r)
	// The fallback lets /prompts/{id} return the registry's externalized-block
	// fragment text when the embedded .md is not found (blocks/<id> has moved
	// into plugin instructions and has no .md).
	(&publicroutes.PromptsHandlers{
		Log:      deps.Log,
		Fallback: deps.DiagRegistry.Registry.PromptFragmentText,
	}).Mount(r)
}

func mountRootSEO(r chi.Router, deps *Deps) {
	// /robots.txt + /sitemap.xml are standard SEO-convention paths, not under /api/v1 — hence
	// the empty prefix. Through recordedRoute like every other public surface, which is what
	// makes "a crawler fetched robots.txt" visible to the owner at all.
	recordedRoute(r, deps, "", func(r chi.Router) {
		(&publicroutes.SEOHandlers{Deps: deps.PublicSEO.Deps, Log: deps.Log}).MountRoot(r)
	})
}
