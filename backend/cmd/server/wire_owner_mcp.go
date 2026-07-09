// wire_owner_mcp.go —— build the ownercore plugin's Deps from runtimeDeps. #135: every owner-MCP
// capability moved off core mcphandle into the ownercore in-process plugin; this assembles its
// (fat, but that's the plugin's whole surface) dependency bundle. Called from buildPluginRegistry.

package main

import (
	"github.com/atmaxmoj/standmeet/internal/plugins/ownercore"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func buildOwnerCoreDeps(d *runtimeDeps) *ownercore.Deps {
	corpusDeps := usecases.CorpusDeps{
		Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, NoteRefs: d.noteRefRepo,
		Subjectivity: d.subjectivityRepo, Index: d.corpusIndexer,
	}
	convsDeps := usecases.ConversationsDeps{
		Chats: d.chatRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
		Subjectivity: usecases.NewSubjectivityCiteResolver(d.subjectivityRepo),
	}
	rolesDeps := usecases.RolesDeps{
		Roles: d.roleRepo, Prompts: d.promptRepo,
		Skills: d.skillRepo, MCPServers: d.mcpServerRepo,
	}
	writingsTxDeps := usecases.WritingsTxDeps{
		Writings:    d.writingRepo,
		WritingRefs: d.writingRefRepo,
		Assets:      usecases.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
	}
	return &ownercore.Deps{
		Owners:        d.ownerRepo,
		Codes:         d.codeRepo,
		SEO:           d.seoRepo,
		Corpus:        &corpusDeps,
		Conversations: &convsDeps,
		Prompts:       &usecases.PromptsDeps{Prompts: d.promptRepo},
		Roles:         &rolesDeps,
		MCPServers:    &usecases.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		Skills:        &usecases.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		Writings:      &usecases.WritingsDeps{Writings: d.writingRepo},
		WritingsTx:    &writingsTxDeps,
		CustomPages:   &usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Handle:        &usecases.HandleDeps{Owners: d.ownerRepo},
		Calendar: &ownercore.CalendarOwnerDeps{
			Proxy: d.connectorSlots.Calendar(), Store: calendarStoreAdapter{repo: d.calendarRepo},
		},
		Appearance: d.ownerRepo,
		Log:        d.log,
	}
}
