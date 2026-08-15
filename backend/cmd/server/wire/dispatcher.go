// dispatcher.go —— 建出站收口:这台实例对外能做的每一件事,在这里汇成一处。
//
// 这份清单就是"对外能做什么"的全集 —— 它是交付物,不是脚手架。
//
// 这个文件只做**装配**:把跑着的 repo 装成各域的依赖包,交给收口;收口去各域的 facade 取
// 它们自己声明的操作。这里不该出现任何"这件事怎么算" —— 那在域里。
//
// dispatcher.New(append(resources, ...)) 里剩下的几行是**旧形状**:声明和实现被摊在收口和
// 这里,每个资源一个 wire_disp_*.go。它们正在一个个搬回域里,搬完一个就从这里消失一行。
//
// 装饰器(鉴权/配额/审计/危险操作)统一挂在这里:每个面拿能力都只能经收口,所以策略有唯一的
// 施加点,不会出现"某个 endpoint 忘了加"。

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

// BuildDispatcher —— 组装出站收口。
//
// 组装根只做一件事:把 repo 装成各域的依赖包交给收口(dispatcher.Collect),收口去各域的
// facade 取它们自己声明的操作。下面那一长串 `dispatcher.X(newXOps(d))` 是**旧形状**:
// 声明和实现被摊在收口和这里,每个资源一个 wire_disp_*.go。它们正在一个个搬回域里,
// 搬完一个就从这里消失一行。
func BuildDispatcher(d *deps.Runtime) *dispatcher.Dispatcher {
	resources := dispatcher.Collect(&dispatcher.Deps{
		Corpus:         corpusDepsOf(d),
		BannedIPs:      d.BannedIPRepo,
		AllowedDomains: owner.AllowedDomainsDeps{Instance: d.InstanceRepo},
		OwnerCSS:       d.OwnerRepo,
		Prompts:        owner.PromptsDeps{Prompts: d.PromptRepo},
		Settings: owner.SettingsDeps{
			BYOAI: owner.BYOAIDeps{Owners: d.OwnerRepo},
			// Providers 不能漏:域用它校验 provider 名是不是已知 preset。少给这个字段
			// 不会编译报错,只会在第一次写入时 nil 解引用 —— 装配期的坑。
			AI: owner.AIProviderDeps{
				Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
			},
			Presets: port.AiPresets(),
		},
		// Providers —— 同一个 Owners 仓储 + 同一把 provider 名校验尺子(本子里每一条
		// 都要过它,不只是默认那条)。Spend 是油表那一半:owner 域管油箱,用量表在 stats,
		// 两边在这里合上(#7)。
		Providers: owner.OpsProviders{
			Providers: owner.ProvidersUseDeps{
				Owners: d.OwnerRepo, Providers: port.InferenceProviders{},
				Spend: d.InferenceUsageRepo,
			},
		},
		Account: owner.OpsAccountDeps{
			Account:  owner.AccountDeps{Owners: d.OwnerRepo},
			Recovery: port.RecoveryDeps(d),
		},
		CustomPages: owner.CustomPageDeps{
			Pages: d.CustomPageRepo, Builds: d.CustomBuildRepo,
		},
		Writings: writingsDepsOf(d),
		MCPServers: marketplace.MCPServersDeps{
			Servers: d.MCPServerRepo, Codes: d.CodeRepo, Prober: d.MCPProber,
		},
		// skill 用例要 skill repo + code repo(删之前得看有没有邀请码还在用它)。
		Skills: marketplace.SkillsDeps{Skills: d.SkillRepo, Codes: d.CodeRepo},
		// 装一个市场 skill = 抓远端 SKILL.md + 落成一个自己的 skill,所以两头都要。
		Marketplace: marketplace.InstallSkillDeps{
			Marketplace: d.MarketplaceClient, Skills: d.SkillRepo,
			// Connectors —— 搜索结果上那句「还缺哪几个连接器」由它答(F-F-4)。
			Connectors: d.ConnectorNeeds,
		},
		Page:           pageDepsOf(d),
		SEO:            seoDepsOf(d),
		AccessRequests: accessRequestDepsOf(d),
		Codes:          codeDepsOf(d),
		Roles:          roleDepsOf(d),
		Conversations:  conversationDepsOf(d),
		APIKeys:        apiKeyDepsOf(d),
		Instance: stats.InstanceDeps{
			System: port.NewSysInfoProvider(d), Usage: d.InferenceUsageRepo,
			Growth: d.GrowthRepo, Activity: d.ActivityRepo, Jobs: d.JobRegistry,
		},
	})
	// 两根插件轴自己的那两个资源:它们没有域可归(读的是能力注册表和连接器槽),
	// 所以声明也在这一侧 —— 见 axiscap/ops.go / axiscap/config.go。
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
		Owners:    d.OwnerRepo,
		Pins:      owner.PagePinDeps{Owners: d.OwnerRepo, Wiki: d.WikiRepo},
		Handle:    owner.HandleDeps{Owners: d.OwnerRepo},
		PublicURL: owner.PublicURLDeps{Owners: d.OwnerRepo},
	}
}

// seoDepsOf —— 公开一条 wiki 的另一半是主页:取消公开要把 pin 着它的栏目一起摘掉。
func seoDepsOf(d *deps.Runtime) owner.OpsSEO {
	return owner.OpsSEO{
		SEO:  d.SEORepo,
		Pins: owner.PagePinDeps{Owners: d.OwnerRepo, Wiki: d.WikiRepo},
		// 发布改的是那条笔记 → 写完刷它的检索文档（索引里的 published 是 public 身份的准入判据）。
		Corpus: corpusDepsOf(d),
	}
}

// accessRequestDepsOf —— 申请这份数据在 access,批准的闭环(发码 + 发信 + 置 replied)在 owner。
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

// apiKeyDepsOf —— 能开给 API 面的是哪些能力,那是能力轴的知识,所以从这一侧注入。
func apiKeyDepsOf(d *deps.Runtime) access.OpsAPIKeys {
	return access.OpsAPIKeys{
		Keys: d.APIKeyRepo, Roles: d.RoleRepo,
		APICandidates: paritymanifest.APICandidateCapabilities,
	}
}

// conversationDepsOf —— 逐字稿要回读被引条目的正文,所以连着语料仓储一起给。
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

// roleDepsOf —— ValidCapabilityIDs 存的是**闭包**:能力注册表要等 registerAgentSkills
// 跑完才齐,而收口在那之前就建好了。存快照的话 dock 按钮会拿到一张空的合法能力表。
func roleDepsOf(d *deps.Runtime) access.OpsRoles {
	return access.OpsRoles{
		Roles: access.RolesDeps{
			Roles: d.RoleRepo,
			Refs:  port.NewRoleRefValidator(d),
		},
		ValidCapabilityIDs: dockableCapabilitiesOf(d),
		// 各能力在一个 role 上占的字段(calendar.book 的 notify_owner 是第一个),按 manifest
		// 的 RoleConfig 声明合成一个通用面 —— 跟码那份同一个机制,只换挂载点。
		Extras: axiscap.RoleFieldSurface(d),
	}
}

// dockableCapabilitiesOf —— 「技能是这几个的 role，dock 上挂得住哪些能力」。
//
// 两件事在这里合起来，因为**只有根同时看得见它们**：能力注册表知道谁是 `acl: always`、谁要
// 授权；技能库知道这些技能授出了哪些工具。域那边只声明「给我一个能回答这个问题的函数」。
//
// 读技能失败时**退到只认无条件暴露的那几个**（最严），而不是放行整张表：宽松的那一侧正是
// F-D-13 的病灶 —— 收下一颗访客永远看不到的按钮。
func dockableCapabilitiesOf(d *deps.Runtime) func(context.Context, string, []string) []string {
	return func(ctx context.Context, ownerID string, skillIDs []string) []string {
		return d.AgentSkills.DockableCapabilityIDs(roleAllowedTools(ctx, d, ownerID, skillIDs))
	}
}

// roleAllowedTools —— 这些技能一共授出了哪些工具（跟会话装配那侧同一个并集，见
// `collectRoleSkillBundle`）。
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
		// 各能力在码上占的字段(booker 的 max_bookings 是第一个),按 manifest 的 CodeConfig
		// 声明合成一个通用面 —— 见 wire_code_config.go。
		Extras: axiscap.CodeFieldSurface(d),
	}
}

// AdminFace —— admin HTTP 面在 parity 里的档案。它是浏览器应用,所以能承载浏览器流程、
// 明文密钥、multipart 这三类 MCP 承载不了的东西(Reach 的 .Except(...) 据此放行)。
func AdminFace(d *dispatcher.Dispatcher) *dispatcher.Face {
	return d.Attach(fp.Facade{
		Name: "admin", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	})
}
