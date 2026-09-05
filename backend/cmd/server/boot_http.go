// boot_http.go —— composition root's HTTP assembly (moved from internal/infra/server per the
// routes-not-imported/infra-not-domain layering). Wires each routes sub-package's Mount calls plus
// middleware shared across sub-routers (request id, slog request log, recovery). No business logic.

package main

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/cmd/server/wire"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
	authmw "github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/routes/pubapi"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
)

// Deps holds the dependencies server assembly needs; the composition root (cmd/server) fills
// this in. AdminDeps is placed last so its bool fields don't waste space on trailing padding.
type Deps struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
	Log   *slog.Logger
	// CaptchaVerifier —— login captcha verifier; composition root assembles it from env.
	CaptchaVerifier      security.Verifier
	Public               publicroutes.Handlers
	PublicPage           publicroutes.PageHandlers
	PublicSEO            publicroutes.SEOHandlers
	PublicMicrosites     publicroutes.MicrositeHandlers
	PublicMicrositeStore publicroutes.MicrositeStoreHandlers
	// PublicMicrositePreview —— owner-panel preview tile. Public-side but **token-gated**:
	// must serve without an admin cookie (a sandboxed iframe's sub-resources carry none).
	PublicMicrositePreview publicroutes.MicrositePreviewHandlers
	PublicAccessRequests   publicroutes.AccessRequestsHandlers
	PublicPasswordReset    publicroutes.PasswordResetHandlers
	PublicWritings         publicroutes.WritingHandlers
	Builds                 sysroutes.BuilderDeps
	IM                     sysroutes.IMDeps
	TLSAsk                 sysroutes.TLSAskDeps
	PrintSession           sysroutes.PrintSessionDeps
	DiagRegistry           sysroutes.DiagRegistryDeps
	DiagSession            sysroutes.DiagSessionDeps
	DiagConnector          sysroutes.DiagConnectorDeps
	DiagSandbox            sysroutes.DiagSandboxDeps
	// PluginRegistry —— J.5: outbound plugins register their full admin REST hook set in one
	// shot. mountAdmin calls MountAllAdminRoutes inside the WithOwner+RequireCSRF group.
	PluginRegistry *capabilities.Registry
	// BannedIPs —— banned-IP repo used by the public BanGuard (enforcement, not an owner cap).
	BannedIPs *security.BannedIPRepo
	// Dispatch —— the outbound convergence point. Admin-side capabilities can only be wired
	// from here (route shapes are still hand-written as usual).
	Dispatch *dispatcher.Dispatcher
	// PubAPI —— the API-key facade (/api/pub/v1); api-key auth in its own middleware.
	PubAPI *pubapi.Handlers
	MCP    mcphandle.Deps
	Admin  AdminDeps
	// CaptchaEnabled —— whether captcha is actually enabled (not noop); the captcha-escape
	// for the #169 code guard.
	CaptchaEnabled bool
}

// AdminDeps packages up, on its own, the business deps the admin sub-router needs.
type AdminDeps struct {
	Corpus          corpus.Deps
	ApproveRequests owner.ApproveRequestDeps
	Conversations   conversation.ConversationsDeps
	Marketplace     marketplace.SearchDeps
	Keypairs        owner.KeypairDeps
	Claim           owner.ClaimDeps
	MCPServers      marketplace.MCPServersDeps
	Recovery        owner.RecoveryDeps
	AccessRequests  access.RequestsDeps
	EmailChange     owner.EmailChangeDeps
	AIProvider      owner.AIProviderDeps
	Roles           access.RolesDeps
	Login           owner.LoginDeps
	Connectors      adminroutes.ConnectorsAdminDeps
	Assets          corpus.AssetsDeps
	Skills          marketplace.SkillsDeps
	Prompts         owner.PromptsDeps
	Owners          *owner.Repo
	AccountAdmin    owner.AccountDeps
	PublicURLAdmin  owner.PublicURLDeps
	Writings        corpus.WritingsDeps
	WritingRefs     *corpus.WritingRefRepo
	SEO             *corpus.SEORepo
	Codes           *access.CodeRepo
	CodeDenials     *access.CodeDenialRepo
	Sessions        *session.OwnerSessionStore
	Drafts          *jobsuc.ResumeDraftRepo
	Applications    *jobsuc.ApplicationRepo
	HandleAdmin     owner.HandleDeps
	BYOAI           owner.BYOAIDeps
	Ghosts          conversation.GhostDeps
	Microsites      owner.MicrositeDeps
	SecureCookie    bool
}

// New returns a chi router with routes already mounted, ready to hand straight to http.Server.
// Pointer receiver avoids gocritic hugeParam.
func New(deps *Deps) http.Handler {
	// QUERY (RFC 10008) is outside chi's default method table; registering it is what keeps
	// r.Method("QUERY", ...) from panicking. Used by the read-only tools' dispatch route
	// (routes/public/chat.go). Must be called before routes are mounted.
	chi.RegisterMethod("QUERY")
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	// After RealIP: decide once whether the source address is actually the visitor's. With no
	// forwarded header, RemoteAddr stops at the app's own hop — treating that as the visitor's
	// would skew the IP column / bans / brute-force locks across the board. See clientaddr.
	r.Use(clientaddr.Middleware(deps.Log))
	r.Use(chimw.Recoverer)
	r.Use(requestLogger(deps.Log))

	mountInternal(r, deps)
	mountAdmin(r, deps)
	mountPublic(r, deps)
	mountRootSEO(r, deps)
	if deps.PubAPI != nil {
		deps.PubAPI.Mount(r)
	}
	// Two MCP faces, two planes: `/mcp` is the owner's own (Sigv1 signature verification),
	// `/mcp/visitor` is for **whoever holds a code** (Bearer, that code). Mount the visitor
	// one first: chi's Mount matches by prefix, so mounting `/mcp` first would swallow it too.
	r.Mount("/mcp/visitor",
		deps.Public.MountVisitorMCP(paritymanifest.APIRenderableTools()))
	r.Mount("/mcp", mcphandle.New(&deps.MCP))
	assertDispatcherConformance(deps)
	return r
}

// assertDispatcherConformance —— once every face is mounted, checks each op's Reach against
// what each face actually projects. Any shortfall means **this process does not get to stay
// alive**: a face missing a capability raises no request error, it just quietly doesn't
// exist, and that's only found once someone tries to use it, by when it's already live.
// Failing at startup is the only shape that catches it before it ships. This also replaces
// the old hand-written cross-reference table, which only got reconciled when someone ran
// the tests and remembered to update it.
func assertDispatcherConformance(deps *Deps) {
	if deps.Dispatch == nil {
		return // may be left unwired in tests
	}
	if report := deps.Dispatch.ConformReport(); report != "" {
		panic("dispatcher: a face does not match the outbound convergence point — " +
			"some capability is not projected onto a face it is owed on:\n" + report)
	}
}

func mountInternal(r chi.Router, deps *Deps) {
	r.Route("/internal", func(r chi.Router) {
		sysroutes.Mount(r, sysroutes.Deps{DB: deps.DB, Redis: deps.Redis, Log: deps.Log})
		sysroutes.MountBuilds(r, deps.Builds)
		sysroutes.MountIM(r, deps.IM)
		sysroutes.MountTLSAsk(r, deps.TLSAsk)
		sysroutes.MountPrintSession(r, deps.PrintSession)
		sysroutes.MountDiagRegistry(r, deps.DiagRegistry)
		sysroutes.MountDiagSandbox(r, deps.DiagSandbox)
		sysroutes.MountDiagSession(r, deps.DiagSession)
	})
}

func mountAdmin(r chi.Router, deps *Deps) {
	r.Route("/api/admin", func(r chi.Router) {
		adminH := buildAdminHandlers(deps)
		mustBeWired(adminH)
		adminH.MountUnauthed(r, authmw.LoginGuard(
			deps.Redis, deps.CaptchaVerifier, deps.CaptchaEnabled,
		))
		r.Group(func(r chi.Router) {
			r.Use(authmw.WithOwner(deps.Admin.Sessions))
			r.Use(authmw.RequireCSRF)
			adminH.MountAuthed(r, authmw.CredentialGuard(deps.Redis))
			// Connector diag (owner-authed; only reachable with a session cookie
			// scoped to path=/api/admin).
			sysroutes.MountDiagConnector(r, deps.DiagConnector)
			// #147 sandbox admin panel (owner-authed; reuses the diag handler,
			// path /api/admin/sandbox/*).
			sysroutes.MountAdminSandbox(r, deps.DiagSandbox)
			deps.PluginRegistry.MountAllAdminRoutes(r)
		})
	})
}

// mustBeWired —— if assembly missed wiring a dep, refuse to start. The cost of a
// missed field isn't "one fewer feature" — it's a nil repo on that path, a nil-pointer
// panic on the first request, and the owner seeing a completely unrelated explanation
// on screen (see internal/infra/depcheck).
func mustBeWired(h *adminroutes.Handlers) {
	if err := h.AssertDepsWired(); err != nil {
		panic(err)
	}
}

// installHomepageHook — the post-claim default-homepage install, built here because the
// microsite repos live at the composition root (the routing layer can't reach them). Best-effort.
func installHomepageHook(deps *Deps) func(context.Context, string) error {
	return func(ctx context.Context, ownerID string) error {
		return owner.InstallDefaultHomepage(ctx, deps.Admin.Microsites, ownerID, deps.Log)
	}
}

func buildAdminHandlers(deps *Deps) *adminroutes.Handlers {
	return &adminroutes.Handlers{
		Claim: deps.Admin.Claim,
		Auth: adminroutes.AuthDeps{
			Login: deps.Admin.Login, Sessions: deps.Admin.Sessions,
		},
		KeypairsAdmin: adminroutes.KeypairsAdminDeps{
			Deps: deps.Admin.Keypairs, Log: deps.Log,
		},
		Corpus: adminroutes.CorpusDeps{
			Corpus: deps.Admin.Corpus, Face: wire.AdminFace(deps.Dispatch),
		},
		CodesAdmin: adminroutes.CodesDeps{Face: wire.AdminFace(deps.Dispatch)},
		// APIKeysAdmin —— outbound-key panel (F-K-1). Same AdminFace gates it by an op's reach;
		// those ops now declare OwnerRead/OwnerAction on both owner faces, no longer mcp-only.
		APIKeysAdmin:   adminroutes.APIKeysAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		SEOAdmin:       adminroutes.SEOAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		Conversations:  adminroutes.ConversationsDeps{Face: wire.AdminFace(deps.Dispatch)},
		BYOAI:          adminroutes.BYOAIDeps{Face: wire.AdminFace(deps.Dispatch)},
		Domains:        adminroutes.DomainsDeps{Face: wire.AdminFace(deps.Dispatch)},
		AccessRequests: adminroutes.AccessRequestsDeps{Face: wire.AdminFace(deps.Dispatch)},
		HandleAdmin:    adminroutes.HandleDeps{Face: wire.AdminFace(deps.Dispatch)},
		PublicURLAdmin: adminroutes.PublicURLDeps{Face: wire.AdminFace(deps.Dispatch)},
		AccountAdmin:   adminroutes.AccountDeps{Face: wire.AdminFace(deps.Dispatch)},
		Recovery:       deps.Admin.Recovery,
		EmailChange:    deps.Admin.EmailChange, // see depcheck for the cost of missing it
		// Plugins' builtins + the default homepage are handed in from here (composition root).
		SeedPlugins:     deps.PluginRegistry.SeedAllOwners,
		InstallHomepage: installHomepageHook(deps),
		AIProviderAdmin: adminroutes.AIProviderDeps{Face: wire.AdminFace(deps.Dispatch)},
		ProvidersAdmin:  adminroutes.ProvidersAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		MicrositesAdmin: adminroutes.MicrositesDeps{
			Face: wire.AdminFace(deps.Dispatch), Notifier: deps.Builds.Notifier,
		},
		// Preview goes through the domain, not the dispatcher: it hands back **file bytes**, and
		// the convergence path is JSON ops. Same reasoning as the public-side /p/{slug}.
		SkillsAdmin:     adminroutes.SkillsAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		PromptsAdmin:    adminroutes.PromptsAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		RolesAdmin:      adminroutes.RolesAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		MCPServersAdmin: adminroutes.MCPServersAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		WritingsAdmin: adminroutes.WritingsAdminDeps{
			Face: wire.AdminFace(deps.Dispatch),
			WritingsTx: corpus.WritingsTxDeps{
				Writings: deps.Admin.Writings.Writings, WritingRefs: deps.Admin.WritingRefs,
				Assets: deps.Admin.Assets,
			},
			Tree: deps.Admin.Writings.Writings,
		},
		Obsidian: adminroutes.ObsidianDeps{
			Writings: deps.Admin.Writings.Writings,
			Assets:   deps.Admin.Assets.Repo,
			Storage:  deps.Admin.Assets.Storage,
			Corpus:   deps.Admin.Corpus, // sync face: VaultSync + Raw + WikiRefs all live here
			CSS:      deps.Admin.Owners, // .obsidian/snippets harvest → owner CSS
			WritingsTx: corpus.WritingsTxDeps{
				Writings: deps.Admin.Writings.Writings, WritingRefs: deps.Admin.WritingRefs,
				Assets: deps.Admin.Assets,
			},
			// Same owners repo: it's already where CSS lands, so the import receipt
			// (UX-62) hangs off owner too — one instance has exactly one vault.
			ImportReceipt: deps.Admin.Owners,
			Log:           deps.Log,
		},
		MarketplaceAdmin:  adminroutes.MarketplaceAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		ConnectorsAdmin:   deps.Admin.Connectors,
		CapabilitiesAdmin: adminroutes.CapabilityAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		IPBansAdmin:       adminroutes.IPBansAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		InstanceAdmin:     adminroutes.InstanceAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		AppearanceAdmin:   adminroutes.AppearanceAdminDeps{Face: wire.AdminFace(deps.Dispatch)},
		CapabilityConfigAdmin: adminroutes.CapabilityConfigAdminDeps{
			Face: wire.AdminFace(deps.Dispatch),
		},
		Log:          deps.Log,
		SecureCookie: deps.Admin.SecureCookie,
	}
}

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
	r.Route("/api/v1", func(r chi.Router) {
		// CORS at the outermost layer: embeds load cross-origin from any origin, so
		// preflight + the ACAO header must be mounted before Ban/Rate (even a later
		// 403/429 still needs to be readable by cross-origin JS). D.2 wide-open.
		r.Use(authmw.PublicCORS)
		// Block banned IPs first (403), then per-IP rate-limit the public abuse
		// surface (429).
		r.Use(authmw.BanGuard(deps.BannedIPs))
		r.Use(authmw.PublicRateGuard(deps.Redis))
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
		// The fallback lets /prompts/{id} return the registry's externalized-capability
		// fragment text when the embedded .md is not found (capabilities/<id> has moved
		// into plugin instructions and has no .md).
		(&publicroutes.PromptsHandlers{
			Log:      deps.Log,
			Fallback: deps.DiagRegistry.Registry.PromptFragmentText,
		}).Mount(r)
	})
}

func mountRootSEO(r chi.Router, deps *Deps) {
	// /robots.txt + /sitemap.xml are standard SEO-convention paths, not under /api/v1.
	(&publicroutes.SEOHandlers{Deps: deps.PublicSEO.Deps, Log: deps.Log}).MountRoot(r)
}
