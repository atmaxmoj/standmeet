// wire_owner_mcp.go —— build the ownercore plugin's Deps from runtimeDeps. #135: every owner-MCP
// capability moved off core mcphandle into the ownercore in-process plugin; this assembles its
// (fat, but that's the plugin's whole surface) dependency bundle. Called from buildPluginRegistry.

package main

import (
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/owner"
	"github.com/atmaxmoj/standmeet/internal/plugins/ownercore"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func buildOwnerCoreDeps(d *runtimeDeps) *ownercore.Deps {
	corpusDeps := corpus.Deps{
		Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, NoteRefs: d.noteRefRepo,
		Subjectivity: d.subjectivityRepo, Index: d.corpusIndexer,
	}
	convsDeps := usecases.ConversationsDeps{
		Chats: d.chatRepo, Wiki: d.wikiRepo, Writing: d.writingRepo, Output: d.outputRepo,
		Subjectivity: corpus.NewSubjectivityCiteResolver(d.subjectivityRepo),
	}
	rolesDeps := usecases.RolesDeps{
		Roles: d.roleRepo, Prompts: d.promptRepo,
		Skills: d.skillRepo, MCPServers: d.mcpServerRepo,
	}
	writingsTxDeps := corpus.WritingsTxDeps{
		Writings:    d.writingRepo,
		WritingRefs: d.writingRefRepo,
		Assets:      corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
	}
	return &ownercore.Deps{
		Owners:           d.ownerRepo,
		Codes:            d.codeRepo,
		CodeBookingQuota: newBookerQuotaStore(d),
		SEO:              d.seoRepo,
		PagePins:         usecases.PagePinDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
		Corpus:           &corpusDeps,
		Conversations:    &convsDeps,
		Prompts:          &owner.PromptsDeps{Prompts: d.promptRepo},
		Roles:            &rolesDeps,
		MCPServers:       &marketplace.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Skills:           &marketplace.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		Writings:         &corpus.WritingsDeps{Writings: d.writingRepo},
		WritingsTx:       &writingsTxDeps,
		CustomPages: &owner.CustomPageDeps{
			Pages: d.customPageRepo, Builds: d.customBuildRepo,
		},
		Handle: &owner.HandleDeps{Owners: d.ownerRepo},
		Calendar: &ownercore.CalendarOwnerDeps{
			Proxy: d.connectorSlots.Calendar(), Store: newCapstoreBookingStore(d),
		},
		Appearance:     d.ownerRepo,
		IPBans:         ipBanStoreAdapter{repo: d.bannedIPRepo},
		Domains:        owner.AllowedDomainsDeps{Instance: d.instanceRepo},
		AccessRequests: ownerAccessRequestsDeps(d),
		Capabilities: &ownercore.CapabilitiesOwnerDeps{
			Registry: d.agentSkills, Settings: d.capabilityRepo,
			Skills: d.skillRepo, Connectors: d.connectorRepo,
		},
		Instance: ownerInstanceDeps(d),
		APIKeys:  &ownercore.APIKeysOwnerDeps{Keys: d.apiKeyRepo, Roles: d.roleRepo},
		Connectors: &ownercore.ConnectorsOwnerDeps{
			Svc:  connSvcAdapter{svc: newConnectorService(d)},
			Mail: d.connectorSlots.Mail(), MailKind: d.connectorSlots.MailKind,
		},
		Marketplace: marketplace.InstallSkillDeps{
			Marketplace: d.marketplaceClient, Skills: d.skillRepo,
		},
		Booking: &ownercore.BookingOwnerDeps{
			Repo: newCapstoreBookingStore(d), Owners: d.ownerRepo,
		},
		CodeDenials: d.codeDenialRepo,
		PageContent: d.ownerRepo,
		PublicURL:   usecases.PublicURLDeps{Owners: d.ownerRepo},
		SEOStats:    seoStatsAdapter{repo: d.seoRepo},
		Account:     owner.AccountDeps{Owners: d.ownerRepo},
		BYOAI:       owner.BYOAIDeps{Owners: d.ownerRepo},
		AIPresets:   ownerAIPresets(),
		Ghosts:      &conversation.GhostDeps{Repo: d.ghostRepo},
		Log:         d.log,
	}
}

// ownerAccessRequestsDeps —— access-request list/update + approve (issues a code, mails it).
func ownerAccessRequestsDeps(d *runtimeDeps) *ownercore.AccessRequestsOwnerDeps {
	return &ownercore.AccessRequestsOwnerDeps{
		Reqs: usecases.AccessRequestsDeps{Repo: d.accessRequestRepo, Owners: d.ownerRepo},
		Approve: usecases.ApproveRequestDeps{
			Reqs: d.accessRequestRepo, Codes: d.codeRepo, Roles: d.roleRepo,
			Owners: d.ownerRepo, Proxy: outboundSender(d),
		},
	}
}

// ownerInstanceDeps —— instance observability reads (status / usage / growth / activity / jobs).
func ownerInstanceDeps(d *runtimeDeps) *ownercore.InstanceDeps {
	return &ownercore.InstanceDeps{
		System: newSysInfoProvider(d), Usage: d.inferenceUsageRepo,
		Growth: d.growthRepo, Activity: d.activityRepo, Jobs: d.jobRegistry,
	}
}
