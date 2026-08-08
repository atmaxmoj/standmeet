// visitor_deps.go —— #131: visitor 有界上下文的两个 deps 聚合（会话生命周期 +
// capability 接线原料）。从 visitor.go 拆出守 max-lines；类型定义无逻辑。

package usecase

import (
	"context"
	"encoding/json"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/sandbox"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// VisitorSessionDeps —— #131: visitor **会话生命周期**那一有界上下文所需(发码会话 /
// 公开会话 / 续会 / 历史恢复 / 配额派生 / code intro)。不含任何 tool/capability 依赖
// (那些走各 capability 的窄 deps + VisitorSkillsDeps)。god-struct 拆出来的一半。
type VisitorSessionDeps struct {
	Codes    *access.CodeRepo
	Chats    *repo.ChatRepo
	Owners   OwnerGetter
	Skills   SkillGetter // role snapshot freeze 读 ListSkillsForRole
	Roles    *access.RoleRepo
	Prompts  *owner.PromptRepo
	Sessions *access.VisitorSessionStore
	Wiki     corpus.WikiLister // 历史恢复 hydrate conversation view
	Writing  corpus.WritingLister
	Output   corpus.OutputLister
	// AgentSkills —— session 装配时算 capability states / tool specs(retrieval /
	// booker / ext-mcp / owner-skill)。
	AgentSkills *capreg.Registry
	// CodeDenials —— ACL hierarchy 的 code 层(capability-acl-hierarchy.md)。
	// buildRoleSnapshotForCode 冻结前据此从 role grant 里相减。可空(无 code 的
	// public + byoai 路径、或老 facade 没接 → 视作零 deny)。
	CodeDenials CodeDenialReader
	// RoleCapConfig —— 冻结 role snapshot 时读"各能力在这个 role 上的配置"。
	// 可空 = 没有能力声明过 per-role 配置(完全正常的一台实例)。
	RoleCapConfig RoleCapConfigReader
	// Gas —— 油表(#7)。可空 = 这台实例读不到油量,于是每一场都当作没挂表 ——
	// 读不到油量就把所有人挡在门外,是拿一个诊断问题去惩罚访客。
	Gas GasGauge
	// CorpusRefs —— 冻 waypoints 时问「这条 evidence_ref 指得到真笔记吗」(F-A-26)。
	// 可空 = 不做可行性过滤(见 feasibleWaypoints)。
	CorpusRefs CorpusRefResolver
}

// GasGauge —— 一箱油还剩多少 token。nil = 这箱油没挂表。
//
// 这一层不认识 owner_providers,也不认识用量表:那道算术在 owner 域(它管着油箱),
// 实现由组装根接上。这里只问一句"还剩多少",因为要拦的是"这一场还能不能发"。
type GasGauge interface {
	Remaining(ctx context.Context, ownerID, providerID string) (*int64, error)
}

// RoleCapConfigReader —— 按 role 读各能力自己的配置:**能力 id** → 它那份配置(JSON 对象)。
//
// 这一层**不解释里面任何一个键**,也不该知道有哪些能力 —— 所以口子只有一个方法,返回的是
// 不透明的 JSON。实现在组装根(它才认识 capconfig 和 manifest 声明)。
//
// 方法叫 ReadByCapability 而不是 Read:同一个实现上还有一个 Read,返回的是**拍平的字段表**
// (字段名 → 值),Go 类型跟这个一模一样。名字撞上的话,接错了编译器一句话都不会说,
// 而症状是每个能力都读到一份不属于自己的配置。
type RoleCapConfigReader interface {
	ReadByCapability(ctx context.Context, roleID string) map[string]json.RawMessage
}

// History —— 收窄成会话读模型的窄依赖(HistoryDeps),喂
// LoadVisitorView / ConversationForChat。
func (d *VisitorSessionDeps) History() *HistoryDeps {
	return &HistoryDeps{
		Codes: d.Codes, Chats: d.Chats,
		Wiki: d.Wiki, Writing: d.Writing, Output: d.Output,
	}
}

// CodeDenialReader —— 读一张 code 的 deny 集(capability / skill id)。纯 deny：
// code 只能从所选 role 授的里再砍。access.CodeDenialRepo 实现它。
type CodeDenialReader interface {
	ListCapabilities(ctx context.Context, codeID string) ([]string, error)
	ListSkills(ctx context.Context, codeID string) ([]string, error)
	// ListCorpusURIs —— ACL 三类里的 corpus 那类：这张 code 从 role 的正列表收回的 glob。
	ListCorpusURIs(ctx context.Context, codeID string) ([]string, error)
}

// VisitorSkillsDeps —— #131: 注册 visitor capability 时所需的**原料**(capability
// 接线那一半)。RegisterVisitorSkills 据此构造各 capability 的窄 deps。prod wireup +
// eval facade 都构造它。不漏进业务逻辑,只在注册口用一次。
type VisitorSkillsDeps struct {
	Wiki     corpus.WikiLister
	Output   corpus.OutputLister
	Writings corpus.WritingLister
	// #135: booker 外置到沙箱后,它的原料(CalendarProxy / booking store / owner /
	// owner-notify)不再进这里 —— booker 经固定词表 reach-back 网关自取。
	Skills     SkillGetter
	Sandbox    sandbox.Runner
	MCPServers MCPServerGetter
	Reports    ReportStore
	Resolver   inference.Resolver
	// DepConnected —— 命名 connector 依赖连通查询（ext-mcp dep-grant 闸用：工具声明
	// _meta.requires 时按 grant+connected 放行）。prod 注 connector DepRegistry；eval
	// facade 留 nil → ext-mcp 依赖工具一律 fail-closed 隐藏。
	DepConnected DepConnected
	// AgentConnectors —— openapi 连接器的 raw ops 暴露成 agent 工具（§3）的来源。prod 注
	// composition root 的适配器（ConnectorRepo + Hub）；nil → 不暴露任何 agent 工具。
	AgentConnectors AgentConnectorSource
}
