// wire_dispatcher.go —— 建出站收口:这台实例对外能做的每一件事,在这里汇成一处。
//
// 这份清单就是"对外能做什么"的全集 —— 它是交付物,不是脚手架。迁移期它一直长:
// 每把一个资源搬进来,ownercore 就少注册一组,直到 ownercore 整包删除。
//
// **适配器按资源一文件一个**(wire_disp_<资源>.go),跟收口那边的 res_<资源>.go 对着看。
// 这个文件只留"装配"本身:建收口、声明各个面的档案。
//
// 装饰器(鉴权/配额/审计/危险操作)统一挂在这里:每个面拿能力都只能经收口,所以策略有唯一的
// 施加点,不会出现"某个 endpoint 忘了加"。

package main

import (
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// buildDispatcher —— 组装出站收口。
//
// 组装根只做一件事:把 repo 装成各域的依赖包交给收口(dispatcher.Collect),收口去各域的
// facade 取它们自己声明的操作。下面那一长串 `dispatcher.X(newXOps(d))` 是**旧形状**:
// 声明和实现被摊在收口和这里,每个资源一个 wire_disp_*.go。它们正在一个个搬回域里,
// 搬完一个就从这里消失一行。
func buildDispatcher(d *runtimeDeps) *dispatcher.Dispatcher {
	resources := dispatcher.Collect(&dispatcher.Deps{
		Corpus:         corpusDepsOf(d),
		BannedIPs:      d.bannedIPRepo,
		AllowedDomains: owner.AllowedDomainsDeps{Instance: d.instanceRepo},
		OwnerCSS:       d.ownerRepo,
		Prompts:        owner.PromptsDeps{Prompts: d.promptRepo},
		Settings: owner.SettingsDeps{
			BYOAI: owner.BYOAIDeps{Owners: d.ownerRepo},
			// Providers 不能漏:域用它校验 provider 名是不是已知 preset。少给这个字段
			// 不会编译报错,只会在第一次写入时 nil 解引用 —— 装配期的坑。
			AI:      owner.AIProviderDeps{Owners: d.ownerRepo, Providers: inferenceProviders{}},
			Presets: aiPresets(),
		},
		Account: owner.OpsAccountDeps{
			Account:  owner.AccountDeps{Owners: d.ownerRepo},
			Recovery: recoveryDeps(d),
		},
		CustomPages: owner.CustomPageDeps{
			Pages: d.customPageRepo, Builds: d.customBuildRepo,
		},
		Writings: corpus.OpsWritingsDeps{
			Writings: corpus.WritingsDeps{Writings: d.writingRepo},
			Tx: corpus.WritingsTxDeps{
				Writings: d.writingRepo, WritingRefs: d.writingRefRepo,
				Assets: corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
			},
			Log: d.log,
		},
		MCPServers: marketplace.MCPServersDeps{
			Servers: d.mcpServerRepo, Codes: d.codeRepo,
		},
		// skill 用例要 skill repo + code repo(删之前得看有没有邀请码还在用它)。
		Skills: marketplace.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		// 装一个市场 skill = 抓远端 SKILL.md + 落成一个自己的 skill,所以两头都要。
		Marketplace: marketplace.InstallSkillDeps{
			Marketplace: d.marketplaceClient, Skills: d.skillRepo,
		},
		Instance: stats.InstanceDeps{
			System: newSysInfoProvider(d), Usage: d.inferenceUsageRepo,
			Growth: d.growthRepo, Activity: d.activityRepo, Jobs: d.jobRegistry,
		},
	})
	return dispatcher.New(append(resources,
		dispatcher.AccessRequests(newAccessRequestOps(d)),
		dispatcher.Roles(newRoleOps(d)),
		dispatcher.Capabilities(newCapabilityOps(d)),
		dispatcher.CapabilityConfig(newCapConfigOps(d)),
		dispatcher.Codes(newCodeOps(d), newCodeOps(d)),
		dispatcher.SEO(newSEOOps(d)),
		dispatcher.Conversations(newConversationOps(d)),
		dispatcher.Page(newPageOps(d)),
	)...)
}

// adminFace —— admin HTTP 面在 parity 里的档案。它是浏览器应用,所以能承载浏览器流程、
// 明文密钥、multipart 这三类 MCP 承载不了的东西(Reach 的 .Except(...) 据此放行)。
func adminFace(d *dispatcher.Dispatcher) *dispatcher.Face {
	return d.Attach(fp.Facade{
		Name: "admin", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	})
}
