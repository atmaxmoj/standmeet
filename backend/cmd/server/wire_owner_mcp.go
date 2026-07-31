// wire_owner_mcp.go —— build the ownercore plugin's Deps from runtimeDeps. #135: every owner-MCP
// capability moved off core mcphandle into the ownercore in-process plugin; this assembles its
// (fat, but that's the plugin's whole surface) dependency bundle. Called from buildPluginRegistry.

package main

import (
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/ownercore"
)

func buildOwnerCoreDeps(d *runtimeDeps) *ownercore.Deps {
	corpusDeps := corpus.Deps{
		Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, NoteRefs: d.noteRefRepo,
		Subjectivity: d.subjectivityRepo, Index: d.corpusIndexer,
	}
	convsDeps := conversation.ConversationsDeps{
		Chats: d.chatRepo, Wiki: d.wikiRepo, Writing: d.writingRepo, Output: d.outputRepo,
		Subjectivity: corpus.NewSubjectivityCiteResolver(d.subjectivityRepo),
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
		PagePins:         owner.PagePinDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
		Corpus:           &corpusDeps,
		Conversations:    &convsDeps,
		Writings:         &corpus.WritingsDeps{Writings: d.writingRepo},
		WritingsTx:       &writingsTxDeps,
		CustomPages: &owner.CustomPageDeps{
			Pages: d.customPageRepo, Builds: d.customBuildRepo,
		},
		Handle: &owner.HandleDeps{Owners: d.ownerRepo},
		Calendar: &ownercore.CalendarOwnerDeps{
			Proxy: d.connectorSlots.Calendar(), Store: newCapstoreBookingStore(d),
		},
		Appearance: d.ownerRepo,
		APIKeys:    &ownercore.APIKeysOwnerDeps{Keys: d.apiKeyRepo, Roles: d.roleRepo},
		Connectors: &ownercore.ConnectorsOwnerDeps{
			Svc:  connSvcAdapter{svc: newConnectorService(d)},
			Mail: d.connectorSlots.Mail(), MailKind: d.connectorSlots.MailKind,
		},
		Booking: &ownercore.BookingOwnerDeps{
			Repo: newCapstoreBookingStore(d), Owners: d.ownerRepo,
		},
		CodeDenials: d.codeDenialRepo,
		PageContent: d.ownerRepo,
		PublicURL:   owner.PublicURLDeps{Owners: d.ownerRepo},
		SEOStats:    seoStatsAdapter{repo: d.seoRepo},
		Account:     owner.AccountDeps{Owners: d.ownerRepo},
		BYOAI:       owner.BYOAIDeps{Owners: d.ownerRepo},
		AIPresets:   ownerAIPresets(),
		Ghosts:      &conversation.GhostDeps{Repo: d.ghostRepo},
		Log:         d.log,
	}
}
