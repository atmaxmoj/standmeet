// wire_owner_mcp.go —— owner 侧 MCP 工具 handler 的注册（从 wireup.go 的
// registerAgentSkills 拆出，守 max-lines）。把各 usecase 的窄 deps 从 runtimeDeps
// 取料后一次性注册进 d.agentSkills（owner 经自己的 MCP client 调的那批工具）。

package main

import (
	"github.com/atmaxmoj/standmeet/internal/routes/mcphandle"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

func registerOwnerMCPHandlers(d *runtimeDeps) {
	corpusDeps := usecases.CorpusDeps{
		Raw: d.rawRepo, Wiki: d.wikiRepo, Output: d.outputRepo, NoteRefs: d.noteRefRepo,
		Subjectivity: d.subjectivityRepo,
	}
	convsDeps := usecases.ConversationsDeps{
		Chats: d.chatRepo, Wiki: d.wikiRepo, Output: d.outputRepo,
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
	calendarDeps := &mcphandle.CalendarOwnerDeps{
		Proxy: d.connectorSlots.Calendar(), Store: calendarStoreAdapter{repo: d.calendarRepo},
	}
	mcphandle.RegisterAgentSkills(d.agentSkills, &mcphandle.RegisterDeps{
		Owners:        d.ownerRepo,
		SEO:           d.seoRepo,
		Codes:         d.codeRepo,
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
		Calendar:      calendarDeps,
		Appearance:    d.ownerRepo,
		Log:           d.log,
	})
}
