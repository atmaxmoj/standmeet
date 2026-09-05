// boot_wireup.go —— composition root's build*Deps helpers, split out to keep main.go ≤350
// lines (lint cap). Each function maps d *runtimeDeps to one sub-router's Deps struct.

package main

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/axiscap"
	"github.com/atmaxmoj/standmeet/cmd/server/axisconn"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	"github.com/atmaxmoj/standmeet/cmd/server/wire"
	adminroutes "github.com/atmaxmoj/standmeet/internal/routes/admin"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/routes/pubapi"
	publicroutes "github.com/atmaxmoj/standmeet/internal/routes/public"
	sysroutes "github.com/atmaxmoj/standmeet/internal/routes/sys"
)

// buildServerDeps —— assembles each sub-router's Deps block (function-length lint friendly).
func buildServerDeps(d *deps.Runtime) *Deps {
	return &Deps{
		DB:                     d.DB,
		Redis:                  d.RDB,
		Log:                    d.Log,
		Admin:                  buildAdminDeps(d),
		Public:                 buildPublicDeps(d),
		PubAPI:                 buildPubAPIDeps(d),
		PublicPage:             buildPublicPageDeps(d),
		PublicSEO:              buildPublicSEODeps(d),
		PublicMicrosites:       buildPublicMicrositeDeps(d),
		PublicMicrositeStore:   buildPublicMicrositeStoreDeps(d),
		PublicMicrositePreview: buildPublicMicrositePreviewDeps(d),
		PublicAccessRequests:   buildPublicAccessRequestsDeps(d),
		PublicPasswordReset:    buildPublicPasswordResetDeps(d),
		PublicWritings: publicroutes.WritingHandlers{
			Writings: corpus.WritingsDeps{Writings: d.WritingRepo},
			CrossLink: corpus.CrossLinkQueryDeps{
				Writings: d.WritingRepo, WritingRefs: d.WritingRefRepo,
			},
			Page:   owner.PageDeps{Owners: d.OwnerRepo},
			Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
			Log:    d.Log,
		},
		Builds: sysroutes.BuilderDeps{
			Log: d.Log, Builds: d.MicrositeBuildRepo, Pages: d.MicrositeRepo,
			Notifier: d.BuildNotifier,
		},
		IM:           sysroutes.IMDeps{Log: d.Log, Token: telegramTokenReader(d)},
		TLSAsk:       sysroutes.TLSAskDeps{Log: d.Log, Domains: d.InstanceRepo},
		PrintSession: sysroutes.PrintSessionDeps{Log: d.Log, Store: d.PrintStore},
		DiagRegistry: sysroutes.DiagRegistryDeps{Registry: d.AgentSkills, Log: d.Log},
		DiagSession:  buildDiagSessionDeps(d),
		DiagConnector: sysroutes.DiagConnectorDeps{
			Invoke:    diagCategoryInvoke(d),
			AgentCall: d.ConnectorSlots.AgentCall,
			Log:       d.Log,
		},
		DiagSandbox: sysroutes.DiagSandboxDeps{
			Workspaces: d.SandboxWorkspaces, Log: d.Log,
		},
		MCP:             buildMCPDeps(d),
		CaptchaVerifier: d.CaptchaVerifier,
		CaptchaEnabled:  d.CaptchaEnabled,
		PluginRegistry:  d.PluginRegistry,
		BannedIPs:       d.BannedIPRepo,
		Dispatch:        d.Dispatch,
	}
}

// (The one-off boot maintenance step is gone: purging old inference_usage rows is now a
// periodic job the stats domain declares, same as every other periodic job (see
// wire/periodic.go). periodic.Start still runs once at startup, so it still happens then too.)

func buildAdminDeps(d *deps.Runtime) AdminDeps {
	return AdminDeps{
		Claim: owner.ClaimDeps{
			Instance: d.InstanceRepo, Skills: d.SkillRepo,
			Prompts: d.PromptRepo, Roles: d.RoleRepo,
		},
		Login:    owner.LoginDeps{Owners: d.OwnerRepo, Sessions: d.SessionStore},
		Keypairs: port.KeypairDeps(d),
		Corpus: corpus.Deps{
			Raw: d.RawRepo, Wiki: d.WikiRepo, Output: d.OutputRepo, NoteRefs: d.NoteRefRepo,
			Subjectivity: d.SubjectivityRepo, VaultSync: d.VaultSyncRepo, Index: d.CorpusIndexer,
		},
		Conversations: conversation.ConversationsDeps{
			Chats: d.ChatRepo, Wiki: d.WikiRepo, Writing: d.WritingRepo, Output: d.OutputRepo,
			Subjectivity: corpus.NewSubjectivityCiteResolver(d.SubjectivityRepo),
		},
		Ghosts: conversation.GhostDeps{Repo: d.GhostRepo},
		BYOAI:  owner.BYOAIDeps{Owners: d.OwnerRepo},
		AccessRequests: access.RequestsDeps{
			Repo:   d.AccessRequestRepo,
			Owners: port.NewSoleOwnerLookup(d),
		},
		HandleAdmin:    owner.HandleDeps{Owners: d.OwnerRepo},
		PublicURLAdmin: owner.PublicURLDeps{Owners: d.OwnerRepo},
		AccountAdmin:   owner.AccountDeps{Owners: d.OwnerRepo},
		Recovery:       port.RecoveryDeps(d),
		EmailChange:    port.EmailChangeDeps(d),
		AIProvider: owner.AIProviderDeps{
			Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
		},
		Microsites: owner.MicrositeDeps{Pages: d.MicrositeRepo, Builds: d.MicrositeBuildRepo},
		Skills:     marketplace.SkillsDeps{Skills: d.SkillRepo, Codes: d.CodeRepo},
		Prompts:    owner.PromptsDeps{Prompts: d.PromptRepo},
		Roles: access.RolesDeps{
			Roles: d.RoleRepo,
			Refs:  port.NewRoleRefValidator(d),
		},
		// Prober: owner actively asking a server "do you answer?" Implemented at the
		// root (mcp_probe.go), mounted on Runtime (F-D-8) so convergence reuses this instance.
		MCPServers: marketplace.MCPServersDeps{
			Servers: d.MCPServerRepo, Codes: d.CodeRepo, Prober: d.MCPProber,
		},
		Assets:       corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
		Writings:     corpus.WritingsDeps{Writings: d.WritingRepo},
		WritingRefs:  d.WritingRefRepo,
		SEO:          d.SEORepo,
		Codes:        d.CodeRepo,
		CodeDenials:  d.CodeDenialRepo,
		Owners:       d.OwnerRepo,
		Drafts:       d.ResumeDraftRepo,
		Applications: d.ApplicationRepo,
		Marketplace:  marketplace.SearchDeps{Client: d.MarketplaceClient},
		Connectors:   connectorsAdminDeps(d),
		ApproveRequests: owner.ApproveRequestDeps{
			Reqs: d.AccessRequestRepo, Codes: d.CodeRepo, Roles: d.RoleRepo,
			Owners: d.OwnerRepo, Proxy: port.OutboundSender(d),
		},
		Sessions:     d.SessionStore,
		SecureCookie: d.SecureCookie,
	}
}

// buildDiagSessionDeps —— deps for /internal/diag/session. Each capability's own closure
// holds its deps; this struct only carries the session store + registry.
func buildDiagSessionDeps(d *deps.Runtime) sysroutes.DiagSessionDeps {
	return sysroutes.DiagSessionDeps{
		Sessions: d.VisitorStore,
		Registry: d.AgentSkills,
		// Same source as owner.meta: persona name must match what went out (UX-66).
		Owners: d.OwnerRepo,
		Log:    d.Log,
	}
}

// registerAgentSkills —— registers every visitor- and owner-side builtin capability into
// d.agentSkills. Shares repo references with build*Deps; called once during run(), and
// the capability closures hold these deps unchanged for the rest of the server's run.
func registerAgentSkills(ctx context.Context, d *deps.Runtime) {
	axiscap.SandboxWorkspaces(d)
	// The connector-name dependency registry is built and set in one place: the ext-mcp
	// dep-grant gate (a tool's _meta.requires passes on grant+connected) and
	// registerDiscoveredPlugins's Requires check share this same instance.
	depReg := axisconn.DepRegistry(ctx, d)
	d.AgentSkills.SetDepRegistry(depReg)
	// Also mounted on Runtime: outbound convergence assembles before this, and the
	// marketplace-search path only fetches it when actually invoked.
	d.DepRegistry = depReg
	skills := buildVisitorSkillsDeps(d)
	skills.DepConnected = depReg
	capload.RegisterVisitorSkills(d.AgentSkills, &skills, d.ChatRepo)
	// Plugins register their own capabilities into the same capreg.Registry (duplicate
	// IDs backstopped by a panic in capreg). The old owner-MCP bundle is off this path:
	// each op is now declared by its own domain, projected onto MCP via convergence.
	d.PluginRegistry.RegisterAllCapabilities(d.AgentSkills)
	// Inbound convergence point: each capability orders by name from its own manifest,
	// dispatched here. Replaces four hand-written gateways (summarize / booker /
	// mail-sender / retrieval), each of which stood up its own socket and verbs.
	wire.HostDesk(ctx, d, &skills)
	wire.SearchIndex(ctx, d)
	// Builtin roles must be backfilled for pre-existing owners too: the new `invited`
	// role is the default profile for issuing codes, so an old instance missing it can't.
	wire.BuiltinRoles(ctx, d)
	hooks := map[string]capload.CapHooks{
		"corpus.retrieval": {Fragment: capload.CorpusScopeVisible},
	}
	// The usage gate mounts per each capability's Quota declaration (gate and
	// remaining-balance figure share one count).
	axiscap.CapabilityQuotaHooks(d, hooks)
	axiscap.RegisterDiscoveredPlugins(d, depReg, hooks)
	axiscap.CapabilityEnableGate(d)
	// Periodic jobs: declared all over, scheduled from one place. Last on purpose —
	// declarations complete only once every plugin has registered.
	wire.PeriodicJobs(ctx, d)
}

// buildVisitorSkillsDeps —— #131: raw capability registration needs, drawn from here by
// RegisterVisitorSkills. Only used by registerAgentSkills, never enters Handlers.
func buildVisitorSkillsDeps(d *deps.Runtime) conversation.VisitorSkillsDeps {
	return conversation.VisitorSkillsDeps{
		Wiki: d.WikiRepo, Output: d.OutputRepo, Writings: d.WritingRepo,
		Skills:          d.SkillRepo,
		Sandbox:         d.SandboxRunner,
		MCPServers:      &dialableMCPServers{repo: d.MCPServerRepo},
		Reports:         d.ChatReportRepo,
		Resolver:        d.ProviderResolver,
		AgentConnectors: axisconn.NewAgentConnectorSource(d),
		Resumes:         port.ResumesByCode(d),
	}
}

// apiKeyDefaultRPM —— instance default rate ceiling for API keys (per-key rate_limit_rpm wins).
const apiKeyDefaultRPM = 120

// newVisitorSessionDeps —— role-snapshot bundle shared by visitor routes + API-key facade.
func newVisitorSessionDeps(d *deps.Runtime) conversation.VisitorSessionDeps {
	return conversation.VisitorSessionDeps{
		Codes: d.CodeRepo, Chats: d.ChatRepo,
		Owners: d.OwnerRepo, Skills: d.SkillRepo,
		Roles: d.RoleRepo, Prompts: d.PromptRepo,
		Sessions:    d.VisitorStore,
		Wiki:        d.WikiRepo,
		Writing:     d.WritingRepo,
		Output:      d.OutputRepo,
		AgentSkills: d.AgentSkills,
		CodeDenials: d.CodeDenialRepo,
		// Freezing the role snapshot reads each capability's config for this role, in the domain.
		RoleCapConfig: axiscap.RoleCapConfig(d),
		// Fuel gauge (#7): tank in the owner domain, usage in stats — asks "how much is left".
		Gas: port.OwnerGas{Providers: owner.ProvidersUseDeps{
			Owners: d.OwnerRepo, Spend: d.InferenceUsageRepo,
		}},
		// Freeze sessions with no provider onto the owner's default one — otherwise spend
		// by anonymous/public sessions is invisible to gas accounting and gates (pentest
		// 2026-09-01). Same Providers dependency and adapter as Gas.
		ProviderDefault: port.OwnerGas{Providers: owner.ProvidersUseDeps{
			Owners: d.OwnerRepo, Spend: d.InferenceUsageRepo,
		}},
		// When freezing waypoints, asks "does this evidence_ref resolve to a real note?"
		// (F-A-26). Same IndexDeps as the sandbox's corpus reads — reachable = readable.
		CorpusRefs: corpus.NewRefResolver(wire.CorpusIndexDeps(d)),
	}
}

// buildPubAPIDeps —— API-key facade handlers; reuses visitor assembly + role-snapshot code.
func buildPubAPIDeps(d *deps.Runtime) *pubapi.Handlers {
	vs := newVisitorSessionDeps(d)
	return pubapi.New(&pubapi.Deps{
		Keys:        d.APIKeyRepo,
		Visitor:     &vs,
		AgentSkills: d.AgentSkills,
		Redis:       d.RDB,
		Log:         d.Log,
		DefaultRPM:  apiKeyDefaultRPM,
	})
}

func buildPublicDeps(d *deps.Runtime) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor:      newVisitorSessionDeps(d),
		SecureCookie: d.SecureCookie,
		Outbound:     port.OutboundSender(d),
		Owners:       d.OwnerRepo,
		Resolver:     d.ProviderResolver,
		Reports:      d.ChatReportRepo,
		Sessions:     d.VisitorStore,
		Embeds:       d.EmbedRepo,
		EmbedNonce:   port.EmbedNonceStore(d),
		QueryQueue:   d.QueryQueue,
		Corpus:       d.Corpus,
		Subjectivity: corpus.NewSubjectivityCiteResolver(d.SubjectivityRepo),
		Ledger:       conversation.NewWaypointLedger(d.VaultSyncRepo, d.VisitorStore, d.Log),
		Ghosts:       conversation.GhostDeps{Repo: d.GhostRepo},
		PDFRenderer:  d.ReportPDFRenderer,
		AppState:     d.AppStateRepo,
		Usage:        d.InferenceUsageRepo,
		Log:          d.Log,
	}
}

func buildPublicPageDeps(d *deps.Runtime) publicroutes.PageHandlers {
	return publicroutes.PageHandlers{
		Page: owner.PageDeps{Owners: d.OwnerRepo},
		Log:  d.Log,
		TokenIssuer: &setupTokenIssuerAdapter{
			log: d.Log, repo: d.InstanceRepo, holder: d.SetupTokenHolder,
		},
		CaptchaSiteKey: d.CaptchaSiteKey,
		AppVersion:     port.AppVersion(),
		Outbound:       owner.OutboundStatusDeps{Proxy: port.OutboundSender(d)},
	}
}

func buildPublicSEODeps(d *deps.Runtime) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps: owner.SEODeps{
			Owners: d.OwnerRepo, SEO: d.SEORepo,
			Wiki: d.WikiRepo, Output: d.OutputRepo,
			NoteRefs: d.NoteRefRepo,
			// Assets: the reader resolves standmeet-asset references in the body into URLs.
			Media: &corpus.NoteAssetsDeps{
				Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
				Hero:   d.NoteHeroRepo,
			},
			// Multi-language: identity language + switcher labels (backfilled once on read).
			Vault: d.VaultSyncRepo,
		},
		Sessions: d.VisitorStore,
		Log:      d.Log,
	}
}

func buildPublicAccessRequestsDeps(d *deps.Runtime) publicroutes.AccessRequestsHandlers {
	return publicroutes.AccessRequestsHandlers{
		Reqs: access.RequestsDeps{
			Repo:   d.AccessRequestRepo,
			Owners: port.NewSoleOwnerLookup(d),
		},
		Log: d.Log,
	}
}

func buildPublicPasswordResetDeps(d *deps.Runtime) publicroutes.PasswordResetHandlers {
	return publicroutes.PasswordResetHandlers{
		Deps: owner.PasswordResetDeps{Owners: d.OwnerRepo},
		Log:  d.Log,
	}
}

func buildMCPDeps(d *deps.Runtime) mcphandle.Deps {
	// Tools: capreg (capability axis) + dispatcher (outbound convergence; MCP is one
	// projection). Never overlap: the former ships with plugins, the latter with domains.
	return mcphandle.Deps{
		AgentSkills: d.AgentSkills,
		Dispatcher:  d.Dispatch,
		Keypairs:    port.KeypairDeps(d),
		Version:     port.AppVersion(),
		Log:         d.Log,
	}
}

// connectorsAdminDeps —— admin connectors panel deps: capabilities draw from convergence;
// orchestration keeps only browser bits (OAuth redirects, credential forms) direct.
func connectorsAdminDeps(d *deps.Runtime) adminroutes.ConnectorsAdminDeps {
	return adminroutes.ConnectorsAdminDeps{
		Svc: axisconn.NewService(d), Face: wire.AdminFace(d.Dispatch),
	}
}
