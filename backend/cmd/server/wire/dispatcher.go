// dispatcher.go — builds the outbound convergence point: every action this instance can take
// outward converges here.
//
// This list is the complete set of "what this instance can do outward" — it is a deliverable,
// not scaffolding.
//
// This file only does **assembly**: it wraps the running repos into each domain's deps struct
// and hands them to the dispatcher; the dispatcher pulls the operations each domain's facade
// declares itself. No "how this counts" logic should appear here — that lives in the domain.
//
// The remaining lines inside dispatcher.New(append(resources, ...)) are the **old shape**:
// declaration and implementation are spread across the dispatcher and here, one wire_disp_*.go
// per resource. They are being moved back into their domains one by one; each one moved removes
// a line from here.
//
// Decorators (auth/quota/audit/dangerous-op) are all mounted here uniformly: every facet can
// only obtain a capability through the dispatcher, so policy has a single application point —
// no endpoint can forget to add it.

package wire

import (
	"context"
	"slices"

	"github.com/atmaxmoj/standmeet/cmd/server/axiscap"
	"github.com/atmaxmoj/standmeet/cmd/server/axisconn"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// BuildDispatcher — assembles the outbound convergence point.
//
// The assembly root does one thing only: it wraps the repos into each domain's deps struct and
// hands them to the dispatcher (dispatcher.Collect); the dispatcher pulls the operations each
// domain's facade declares itself. The long list of `dispatcher.X(newXOps(d))` below is the
// **old shape**: declaration and implementation are spread across the dispatcher and here, one
// wire_disp_*.go per resource. They are being moved back into their domains one by one; each
// one moved removes a line from here.
func BuildDispatcher(d *deps.Runtime) *dispatcher.Dispatcher {
	resources := dispatcher.Collect(&dispatcher.Deps{
		Corpus:         corpusDepsOf(d),
		BannedIPs:      d.BannedIPRepo,
		AllowedDomains: owner.AllowedDomainsDeps{Instance: d.InstanceRepo},
		OwnerCSS:       d.OwnerRepo,
		Prompts:        owner.PromptsDeps{Prompts: d.PromptRepo},
		Settings: owner.SettingsDeps{
			BYOAI: owner.BYOAIDeps{Owners: d.OwnerRepo},
			// Providers must not be left out: the domain uses it to validate provider names.
			// Omitting it compiles fine but nil-dereferences on first write — an assembly trap.
			AI: owner.AIProviderDeps{
				Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
			},
			Presets: port.AiPresets(),
		},
		// Providers — same Owners repo + provider-name validation ruler every entry must pass.
		// Spend is the other half: owner manages the tank, stats meters usage; joined here (#7).
		Providers: owner.OpsProviders{
			Providers: owner.ProvidersUseDeps{
				Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
				Spend: d.InferenceUsageRepo,
			},
			// ModelLister — the probe for "which models does this provider have"; unsealed on
			// the root side (same rule as MCP probe), so it comes in via deps (F-R-11).
			ModelLister: d.ProviderModels,
		},
		Account: owner.OpsAccountDeps{
			Account:     owner.AccountDeps{Owners: d.OwnerRepo},
			Recovery:    port.RecoveryDeps(d),
			EmailChange: port.EmailChangeDeps(d),
		},
		CustomPages: owner.CustomPageDeps{
			Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo,
			// The list must sign the preview URL — the token is signed with this
			// server-side key; the frontend never assembles it itself.
			PreviewSigningKey: d.SessionKey,
		},
		Writings: writingsDepsOf(d),
		MCPServers: marketplace.MCPServersDeps{
			Servers: d.MCPServerRepo, Codes: d.CodeRepo, Prober: d.MCPProber,
		},
		// The skill use case needs the skill repo + code repo (check no code still uses it).
		Skills: marketplace.SkillsDeps{Skills: d.SkillRepo, Codes: d.CodeRepo},
		// Installing a marketplace skill fetches the remote SKILL.md + lands it as one's own.
		Marketplace: marketplace.InstallSkillDeps{
			Marketplace: d.MarketplaceClient, Skills: d.SkillRepo,
			// Connectors — answers the "which connectors are still missing" line (F-F-4).
			Connectors: d.ConnectorNeeds,
		},
		Page:           pageDepsOf(d),
		SEO:            seoDepsOf(d),
		AccessRequests: accessRequestDepsOf(d),
		Codes:          codeDepsOf(d),
		Embeds:         access.OpsEmbeds{Embeds: d.EmbedRepo},
		Roles:          roleDepsOf(d),
		Conversations:  conversationDepsOf(d),
		APIKeys:        apiKeyDepsOf(d),
		Instance: stats.InstanceDeps{
			System: port.NewSysInfoProvider(d), Usage: d.InferenceUsageRepo,
			Growth: d.GrowthRepo, Activity: d.ActivityRepo, Jobs: d.JobRegistry,
		},
		Upgrade: stats.UpgradeDeps{
			System: port.NewSysInfoProvider(d), UpgradeSources: d.Upgrade,
		},
	})
	// The two resources belonging to the two plugin axes themselves: they have no domain
	// to belong to (they read the capability registry and connector slots), so their
	// declaration also lives on this side — see axiscap/ops.go / axiscap/config.go.
	return dispatcher.New(append(
		resources,
		axiscap.CapabilityResource(d),
		axiscap.CapabilityConfigResource(d),
		axisconn.ConnectorResource(d),
	)...)
}

func writingsDepsOf(d *deps.Runtime) corpus.OpsWritingsDeps {
	return corpus.OpsWritingsDeps{
		Writings: corpus.WritingsDeps{Writings: d.WritingRepo},
		Tx: corpus.WritingsTxDeps{
			Writings: d.WritingRepo, WritingRefs: d.WritingRefRepo,
			Assets: corpus.AssetsDeps{Repo: d.AssetRepo, Storage: d.StorageClient},
		},
		Log: d.Log,
	}
}

func pageDepsOf(d *deps.Runtime) owner.OpsPage {
	return owner.OpsPage{
		Handle:    owner.HandleDeps{Owners: d.OwnerRepo},
		PublicURL: owner.PublicURLDeps{Owners: d.OwnerRepo},
	}
}

func seoDepsOf(d *deps.Runtime) owner.OpsSEO {
	return owner.OpsSEO{
		SEO: d.SEORepo,
		// Publishing changes that note -> after the write, refresh its search document
		// (the `published` field in the index is the admission criterion for public
		// identity).
		Corpus: corpusDepsOf(d),
	}
}

// accessRequestDepsOf — the request data lives in access; the approval loop (issue code +
// send mail + set replied) lives in owner.
func accessRequestDepsOf(d *deps.Runtime) owner.OpsAccessRequests {
	return owner.OpsAccessRequests{
		Requests: access.RequestsDeps{
			Repo: d.AccessRequestRepo, Owners: port.NewSoleOwnerLookup(d),
		},
		Approve: owner.ApproveRequestDeps{
			Reqs: d.AccessRequestRepo, Codes: d.CodeRepo, Roles: d.RoleRepo,
			Owners: d.OwnerRepo, Proxy: port.OutboundSender(d),
		},
	}
}

// apiKeyDepsOf — which capabilities can be opened to the API facet is knowledge of the
// capability axis, so it's injected from this side.
func apiKeyDepsOf(d *deps.Runtime) access.OpsAPIKeys {
	return access.OpsAPIKeys{
		Keys: d.APIKeyRepo, Roles: d.RoleRepo,
		// The fields each capability occupies on this key (max_bookings...). Same
		// declaration, same mechanism as the code side, only the mount point changes —
		// without it, a quota attached to a key would have nowhere to be set (F-B-11).
		Extras:        axiscap.KeyFieldSurface(d),
		APICandidates: paritymanifest.APICandidateCapabilities,
	}
}

// conversationDepsOf — the transcript needs to read back the body of cited entries, so the
// corpus repo is passed along with it.
func conversationDepsOf(d *deps.Runtime) conversation.OpsConversations {
	return conversation.OpsConversations{
		Chats: conversation.ConversationsDeps{
			Chats: d.ChatRepo, Wiki: d.WikiRepo, Writing: d.WritingRepo,
			Output:       d.OutputRepo,
			Subjectivity: corpus.NewSubjectivityCiteResolver(d.SubjectivityRepo),
		},
		Ghosts: conversation.GhostDeps{Repo: d.GhostRepo},
		Corpus: corpusDepsOf(d),
		Log:    d.Log,
	}
}

// roleDepsOf — ValidCapabilityIDs stores a **closure**: the capability registry isn't
// complete until registerAgentSkills finishes running, and the dispatcher is built before
// that. Storing a snapshot instead would leave the dock button with an empty table of valid
// capabilities.
func roleDepsOf(d *deps.Runtime) access.OpsRoles {
	return access.OpsRoles{
		Roles: access.RolesDeps{
			Roles: d.RoleRepo,
			Refs:  port.NewRoleRefValidator(d),
		},
		ValidCapabilityIDs: dockableCapabilitiesOf(d),
		// The fields each capability occupies on a role (calendar.book's notify_owner is
		// the first one), composed into one generic facet per the manifest's RoleConfig
		// declaration — same mechanism as the code side, only the mount point changes.
		Extras: axiscap.RoleFieldSurface(d),
	}
}

// dockableCapabilitiesOf — "given a role's set of skills, which capabilities can be mounted
// on the dock".
//
// The two things are joined here because **only the root can see both at once**: the
// capability registry knows which are `acl: always` and which need authorization; the skill
// library knows which tools these skills grant. The domain side only declares "give me a
// function that can answer this question".
//
// When reading skills fails, **fall back to recognizing only the unconditionally exposed
// ones** (the strictest option), rather than letting the whole table through: the lenient
// side is exactly the F-D-13 pathology — accepting a button the visitor can never see.
func dockableCapabilitiesOf(d *deps.Runtime) func(context.Context, string, []string) []string {
	return func(ctx context.Context, ownerID string, skillIDs []string) []string {
		return d.AgentSkills.DockableCapabilityIDs(roleAllowedTools(ctx, d, ownerID, skillIDs))
	}
}

// roleAllowedTools — the union of all tools these skills grant (the same union as the
// session-assembly side, see `collectRoleSkillBundle`).
func roleAllowedTools(
	ctx context.Context, d *deps.Runtime, ownerID string, skillIDs []string,
) []string {
	if len(skillIDs) == 0 {
		return []string{}
	}
	skills, err := d.SkillRepo.ListByOwner(ctx, ownerID)
	if err != nil {
		return []string{}
	}
	out := []string{}
	for i := range skills {
		if slices.Contains(skillIDs, skills[i].ID) {
			out = append(out, skills[i].AllowedTools...)
		}
	}
	return out
}

func codeDepsOf(d *deps.Runtime) access.OpsCodes {
	return access.OpsCodes{
		Codes: access.CodesDeps{
			Codes: d.CodeRepo, Roles: d.RoleRepo, Sessions: d.VisitorStore,
		},
		ACL: access.CodeACLDeps{
			Codes: d.CodeRepo, Denials: d.CodeDenialRepo, Roles: d.RoleRepo,
		},
		// The fields each capability occupies on a code (booker's max_bookings is the
		// first one), composed into one generic facet per the manifest's CodeConfig
		// declaration — see wire_code_config.go.
		Extras: axiscap.CodeFieldSurface(d),
	}
}

// AdminFace — the admin HTTP facet's record in parity. It's a browser app, so it can carry
// browser flows, plaintext secrets, and multipart — the three things MCP cannot carry
// (Reach's .Except(...) allows them on this basis).
func AdminFace(d *dispatcher.Dispatcher) *dispatcher.Face {
	return d.Attach(fp.Facade{
		Name: "admin", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	})
}
