// wire_dispatcher.go —— 建出站收口:这台实例对外能做的每一件事,在这里汇成一处。
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

package main

import (
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
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
		Writings:   writingsDepsOf(d),
		MCPServers: marketplace.MCPServersDeps{Servers: d.mcpServerRepo, Codes: d.codeRepo},
		// skill 用例要 skill repo + code repo(删之前得看有没有邀请码还在用它)。
		Skills: marketplace.SkillsDeps{Skills: d.skillRepo, Codes: d.codeRepo},
		// 装一个市场 skill = 抓远端 SKILL.md + 落成一个自己的 skill,所以两头都要。
		Marketplace: marketplace.InstallSkillDeps{
			Marketplace: d.marketplaceClient, Skills: d.skillRepo,
		},
		Page:           pageDepsOf(d),
		SEO:            seoDepsOf(d),
		AccessRequests: accessRequestDepsOf(d),
		Codes:          codeDepsOf(d),
		Roles:          roleDepsOf(d),
		Instance: stats.InstanceDeps{
			System: newSysInfoProvider(d), Usage: d.inferenceUsageRepo,
			Growth: d.growthRepo, Activity: d.activityRepo, Jobs: d.jobRegistry,
		},
	})
	return dispatcher.New(append(resources,
		dispatcher.Capabilities(newCapabilityOps(d)),
		dispatcher.CapabilityConfig(newCapConfigOps(d)),
		dispatcher.Conversations(newConversationOps(d)),
	)...)
}

func writingsDepsOf(d *runtimeDeps) corpus.OpsWritingsDeps {
	return corpus.OpsWritingsDeps{
		Writings: corpus.WritingsDeps{Writings: d.writingRepo},
		Tx: corpus.WritingsTxDeps{
			Writings: d.writingRepo, WritingRefs: d.writingRefRepo,
			Assets: corpus.AssetsDeps{Repo: d.assetRepo, Storage: d.storageClient},
		},
		Log: d.log,
	}
}

func pageDepsOf(d *runtimeDeps) owner.OpsPage {
	return owner.OpsPage{
		Owners:    d.ownerRepo,
		Pins:      owner.PagePinDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
		Handle:    owner.HandleDeps{Owners: d.ownerRepo},
		PublicURL: owner.PublicURLDeps{Owners: d.ownerRepo},
	}
}

// seoDepsOf —— 公开一条 wiki 的另一半是主页:取消公开要把 pin 着它的栏目一起摘掉。
func seoDepsOf(d *runtimeDeps) owner.OpsSEO {
	return owner.OpsSEO{
		SEO:  d.seoRepo,
		Pins: owner.PagePinDeps{Owners: d.ownerRepo, Wiki: d.wikiRepo},
	}
}

// accessRequestDepsOf —— 申请这份数据在 access,批准的闭环(发码 + 发信 + 置 replied)在 owner。
func accessRequestDepsOf(d *runtimeDeps) owner.OpsAccessRequests {
	return owner.OpsAccessRequests{
		Requests: access.RequestsDeps{
			Repo: d.accessRequestRepo, Owners: soleOwnerLookup{owners: d.ownerRepo},
		},
		Approve: owner.ApproveRequestDeps{
			Reqs: d.accessRequestRepo, Codes: d.codeRepo, Roles: d.roleRepo,
			Owners: d.ownerRepo, Proxy: outboundSender(d),
		},
	}
}

// roleDepsOf —— ValidCapabilityIDs 存的是**闭包**:能力注册表要等 registerAgentSkills
// 跑完才齐,而收口在那之前就建好了。存快照的话 dock 按钮会拿到一张空的合法能力表。
func roleDepsOf(d *runtimeDeps) access.OpsRoles {
	return access.OpsRoles{
		Roles: access.RolesDeps{
			Roles: d.roleRepo,
			Refs: roleRefValidator{
				prompts: d.promptRepo, skills: d.skillRepo, servers: d.mcpServerRepo,
			},
		},
		ValidCapabilityIDs: func() []string { return d.agentSkills.VisitorCapabilityIDs() },
	}
}

func codeDepsOf(d *runtimeDeps) access.OpsCodes {
	return access.OpsCodes{
		Codes: access.CodesDeps{
			Codes: d.codeRepo, Roles: d.roleRepo, Sessions: d.visitorStore,
		},
		ACL: access.CodeACLDeps{
			Codes: d.codeRepo, Denials: d.codeDenialRepo, Roles: d.roleRepo,
		},
		// booker 在一张码上占一个 max_bookings 字段,见 booker_code_config.go。
		Extras: newBookerCodeExtras(d),
	}
}

// adminFace —— admin HTTP 面在 parity 里的档案。它是浏览器应用,所以能承载浏览器流程、
// 明文密钥、multipart 这三类 MCP 承载不了的东西(Reach 的 .Except(...) 据此放行)。
func adminFace(d *dispatcher.Dispatcher) *dispatcher.Face {
	return d.Attach(fp.Facade{
		Name: "admin", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	})
}
