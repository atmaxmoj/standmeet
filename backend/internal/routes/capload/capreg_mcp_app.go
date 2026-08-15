// capreg_mcp_app.go —— C3: mcpAppCapability 适配器(泛化 ext-mcp)。
//
// 这是 **MCP app(能力)** 那一类 —— 不是 skill。把一条 mcpplugin.Manifest dial
// 成一个 MCP server、ListTools、每个 tool 包成 BindingTool(register 式)。skill
// (Agent Skills / SKILL.md 内容库)是完全不同的另一类(Phase C),不在这。
//
// VisitorBinding 时按 transport dial → ListTools → 包 BindingTool;_meta.ui 进
// CapabilityState.Extra。dial / list 失败 / 空 tool → ErrHidden(隐藏,不阻塞
// chat)。tool 调用失败折成 errJSON(复用 ext-mcp 的 makeExtMCPRun)。

package capload

import (
	"context"
	"sync"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

type mcpAppCapability struct {
	instrOnce *sync.Once
	instr     *string
	// toolsOnce/tools —— 缓存首拨拿到的 tool specs（name/desc/schema/_meta）。tool 元数据
	// 是 server 级静态的，但每次 VisitorBinding 都重拨 + ListTools 会让 `_meta`（尤其
	// return_directly / progress_label）在高负载冷启时偶发丢失（#149），导致 ask_visitor
	// 卡不返、间歇 flake。读一次缓存：之后每次装配只用 live session 执行，specs 取缓存的
	// 可靠值，彻底消掉 per-dial 的 _meta 读竞态。
	toolsOnce *sync.Once
	tools     *[]mcpclient.Tool
	gate      capreg.SessionGate
	// fragmentGate —— 可选 per-session 谓词，决定本能力是否「实际活跃」：控制
	// SystemPromptFragment 是否贡献 + CapabilityState.Enabled。tool 暴露不受它影响
	// （retrieval: 无 corpus scope 时 enabled=false + 不进 prompt，但 3 个 tool 仍暴露，
	// 内部 ACL 拦）。nil = 恒活跃（默认）。跟 gate（控 tool 暴露）正交。
	fragmentGate func(*capreg.AssembleInput) bool
	stateHook    StateHook
	// dialErrLog —— composition root 注入：dial/list 失败(如 sandbox 起不来)本会静默
	// 折成 ErrHidden(优雅降级,不阻塞 chat),这里在折之前把真因响出来(F-A-1:prod bwrap
	// 起不来 → retrieval 静默 0 工具,日志查无此事)。nil = 静默(老行为)。
	dialErrLog func(id string, err error)
	m          mcpplugin.Manifest
}

// StateHook —— 给某能力的 CapabilityState 补 host 侧算出来的字段（booker: quota_remaining）。
// 装配期调，返回的非零字段（QuotaRemaining / PolicySummary / Extra）overlay 到通用 state。
type StateHook func(context.Context, *capreg.AssembleInput) capreg.CapabilityState

// CapHooks —— composition root 给特定内建挂的 per-session 钩子（都可选）。Gate 控 tool
// 暴露（booker: connector+quota 隐藏）；Fragment 控 prompt 贡献 + enabled（retrieval:
// 无 corpus scope）；State 补 host 侧算的 state 字段（booker: quota_remaining）。三者正交。
type CapHooks struct {
	Gate     capreg.SessionGate
	Fragment func(*capreg.AssembleInput) bool
	State    StateHook
}

func newMCPAppCapability(m *mcpplugin.Manifest) *mcpAppCapability {
	return &mcpAppCapability{
		m: *m, instrOnce: &sync.Once{}, instr: new(string),
		toolsOnce: &sync.Once{}, tools: new([]mcpclient.Tool),
	}
}

// 注册那一段（manifest → 注册好的能力、origin、撞 ID、always 名单）住在
// capreg_mcp_app_register.go。

func (c *mcpAppCapability) ID() string { return c.m.ID }

// Title —— capreg.Titled：透传插件 manifest 声明的人类可读 title（#109/#110 dock 按钮 label）。
// 空 = 该插件没声明 title（不够格当 dock 按钮 label，无 id 兜底）。
func (c *mcpAppCapability) Title() string { return c.m.Title }

func (c *mcpAppCapability) Shape() capreg.Shape {
	return capreg.Shape(string(c.m.Shape))
}

// Requires —— 本插件声明的命名 in-app 依赖（connector 名，来自 manifest.Requires）。
// capreg.enabledCaps 据此走 global 单点闸：任一未连 → 整个 cap 隐藏（D-2）。实现
// capreg.RequiresDeps，让 connector-gating 从写死在 booker 里收成单点。
func (c *mcpAppCapability) Requires() []string { return c.m.Requires }

// SystemPromptFragment —— server initialize instructions 即本能力的 prompt 片段。
// 按暴露门（role-grant）gate：role-granted 插件（外置 booker / echoer / 第三方）只在
// role 授权时贡献 prompt，跟 in-process 时代 booker fragment 随 role gate 的行为一致；
// ACL=always（ask_visitor / summarize）则恒贡献。connector/quota 闸只隐藏 tool，不影响
// prompt（沿用旧行为：role-granted-未连 → fragment 在、tool 隐）。
func (c *mcpAppCapability) SystemPromptFragment(
	ctx context.Context, in *capreg.AssembleInput,
) string {
	if !mcpAppGranted(&c.m, in.RoleSnapshot) || !c.fragmentActive(in) {
		return ""
	}
	return c.cachedInstructions(ctx)
}

// SystemPromptFragmentID —— fragment 活跃时返 "capabilities/<id>"（跟 in-process 时代
// 同一 id），否则空。前端按 part-id 走 GET /api/v1/prompts/{id} 取 fragment 文本拼进
// system prompt；该 id 不再对应 embed 的 .md 文件（已外置），prompts 端点改为 fallback
// 到 registry 返本插件的 server initialize instructions（StaticFragment）。空判定跟
// SystemPromptFragment 同步（都 role-grant + fragmentActive），part_ids 与实际拼接一致。
func (c *mcpAppCapability) SystemPromptFragmentID(
	_ context.Context, in *capreg.AssembleInput,
) string {
	if !mcpAppGranted(&c.m, in.RoleSnapshot) || !c.fragmentActive(in) {
		return ""
	}
	return c.StaticFragmentID()
}

// StaticFragmentID —— 本能力 fragment 的稳定 id（session 无关）。registry 据此把
// GET /prompts/{id} 路由到 StaticFragment。跟 SystemPromptFragmentID 活跃时返的一致。
func (c *mcpAppCapability) StaticFragmentID() string {
	return "capabilities/" + c.m.ID
}

// StaticFragment —— 本能力 fragment 的文本（= server initialize instructions，session
// 无关）。prompts 端点服务外置能力 fragment 用。
func (c *mcpAppCapability) StaticFragment(ctx context.Context) string {
	return c.cachedInstructions(ctx)
}

// VisitorBinding —— ACL gate(role 授权)→ dial → list → wrap。未授权 / dial /
// list 失败 / 空 tool → 隐藏。先查授权再 dial(省掉没授权还白拨的开销)。
func (c *mcpAppCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	expose, gerr := c.exposable(ctx, in)
	if gerr != nil {
		return nil, gerr
	}
	if !expose {
		return nil, capreg.ErrHidden
	}
	ds, derr := c.dialWithCachedSpecs(ctx, in)
	if derr != nil {
		return nil, derr
	}
	return &capreg.Binding{
		Tools:     wrapMCPAppTools(ctx, &c.m, ds.sess, ds.tools, sessionMetaFor(&c.m, in)),
		State:     c.stateFor(ctx, in),
		Close:     ds.sess.Close,
		ClaimGate: claimGateOf(&c.m),
	}, nil
}

// dialWithCachedSpecs —— 拨一次;**tool specs 已经缓存过就不再 ListTools**。
//
// 这一步在访客那侧是可见的:每一次工具调用都要走它(卡片点"发确认信"→
// /sessions/{id}/tools/send_confirmation → 装配 → 这里)。tool 元数据是 server 级
// 静态的、首拨就缓存了,而 ListTools 那一次往返每次都在付 —— 沙箱刚起来时那次往返
// 尤其贵,机器压满时整段实测到过 19 秒(见 public/tools.go 的 slowAssembleThreshold)。
//
// 缓存**没有**顺带省掉拨号本身:session 是有状态的,而且用完就 Close(沙箱只活一轮,
// 见 [[sandbox-lives-one-turn]])。省掉的是已经知道答案还要再问一遍的那一次。
func (c *mcpAppCapability) dialWithCachedSpecs(
	ctx context.Context, in *capreg.AssembleInput,
) (*dialedApp, error) {
	workspace := provisionWorkspaceFor(&c.m, in.ConversationID)
	if cached, known := c.knownToolSpecs(); known {
		return dialOnly(ctx, &c.m, workspace, c.dialErrLog, cached)
	}
	ds, derr := dialAndList(ctx, &c.m, workspace, c.dialErrLog)
	if derr != nil {
		return nil, derr
	}
	ds.tools = c.cachedToolSpecs(ds.tools)
	return ds, nil
}

// cachedToolSpecs —— 首拨缓存 tool specs（含 _meta），之后恒返缓存：tool 元数据是静态
// 的，缓存住就不会被某次冷启高负载的 ListTools 把 return_directly/progress_label 丢掉。
// 执行仍走本次 dial 的 live session（tool name 一致），只有 specs 取缓存。
func (c *mcpAppCapability) cachedToolSpecs(dialed []mcpclient.Tool) []mcpclient.Tool {
	c.toolsOnce.Do(func() {
		*c.tools = dialed
		reportToolDrift(&c.m, dialed)
	})
	return *c.tools
}

// knownToolSpecs —— 已经缓存过就返 (specs, true),没缓存过返 false。**只读**,不触发
// Once —— 触发了的话第一次调用会把一个空切片当成"已知的工具表"缓存住,这个能力从此没有工具。
func (c *mcpAppCapability) knownToolSpecs() ([]mcpclient.Tool, bool) {
	if len(*c.tools) == 0 {
		return []mcpclient.Tool{}, false
	}
	return *c.tools, true
}

// dialOnly —— 拨号,不 ListTools(specs 从缓存来)。失败仍然先把真因喂给 dialErrLog
// 再折成 ErrHidden —— 沙箱起不来时静默隐藏,日志里查无此事,那是 F-A-1。
func dialOnly(
	ctx context.Context, m *mcpplugin.Manifest, workspaceDir string,
	dialErrLog func(id string, err error), specs []mcpclient.Tool,
) (*dialedApp, error) {
	sess, err := dialMCPApp(ctx, m, workspaceDir)
	if err != nil {
		return nil, hideWithLog(dialErrLog, m.ID, err)
	}
	return &dialedApp{sess: sess, tools: specs}, nil
}

// stateFor —— 通用 mcpAppState（id/enabled）+ 可选 stateHook overlay（booker:
// quota_remaining）。enabled 走 fragmentActive。
func (c *mcpAppCapability) stateFor(
	ctx context.Context, in *capreg.AssembleInput,
) capreg.CapabilityState {
	st := mcpAppState(&c.m, c.fragmentActive(in))
	if c.stateHook == nil {
		return st
	}
	hook := c.stateHook(ctx, in)
	overlayCapState(&st, &hook)
	return st
}

// dialedApp —— dialAndList 的结果（会话 + 它的 tool 列表），打包成单返回值（revive
// function-result-limit ≤ 2）。
type dialedApp struct {
	sess  *mcpclient.Session
	tools []mcpclient.Tool
}

// dialAndList —— dial transport + ListTools。dial 失败 / list 失败 / 空 tool 都收成
// ErrHidden（隐藏，不阻塞 chat）；空 tool 时关掉会话不泄漏。
func dialAndList(
	ctx context.Context, m *mcpplugin.Manifest, workspaceDir string,
	dialErrLog func(id string, err error),
) (*dialedApp, error) {
	id := m.ID
	sess, err := dialMCPApp(ctx, m, workspaceDir)
	if err != nil {
		// Infra failure (sandbox couldn't spawn, transport unreachable). Still hide
		// so a broken plugin never blocks chat — but log the real cause first (F-A-1:
		// this branch swallowed the prod bwrap error, leaving `tools:0` unexplained).
		return nil, hideWithLog(dialErrLog, id, err)
	}
	tools, lerr := sess.ListTools(ctx)
	if lerr != nil {
		sess.Close()
		return nil, hideWithLog(dialErrLog, id, lerr)
	}
	if len(tools) == 0 { // a clean, legitimate "no tools" — hide quietly, not an error
		sess.Close()
		return nil, capreg.ErrHidden
	}
	return &dialedApp{sess: sess, tools: tools}, nil
}

// hideWithLog —— dial/list 失败:先把真因喂给 dialErrLog(nil 安全),再折成 ErrHidden
// (优雅降级)。抽出来让 dialAndList 的 cyclo 不超标(每个错误分支收成一句)。
func hideWithLog(dialErrLog func(id string, err error), id string, err error) error {
	if dialErrLog != nil {
		dialErrLog(id, err)
	}
	return capreg.ErrHidden
}

// exposable —— dial 前的两道门：ACL（role-grant）+ 可选 per-session SessionGate
// （booker: connector-connected + quota）。返 (proceed, realErr)：proceed=false →
// 隐藏（caller 折成 ErrHidden）；闸的真错往上抛。挂闸的插件先过闸再 dial，省掉隐藏时
// 还白拨沙箱的开销。
func (c *mcpAppCapability) exposable(
	ctx context.Context, in *capreg.AssembleInput,
) (bool, error) {
	if !mcpAppGranted(&c.m, in.RoleSnapshot) {
		return false, nil
	}
	if c.gate == nil {
		return true, nil
	}
	return c.gate(ctx, in)
}

// fragmentActive —— fragmentGate 谓词（retrieval: 有 corpus scope）。nil = 恒活跃。
// 控 prompt fragment 贡献 + CapabilityState.Enabled。
func (c *mcpAppCapability) fragmentActive(in *capreg.AssembleInput) bool {
	return c.fragmentGate == nil || c.fragmentGate(in)
}

// cachedInstructions —— server 的 initialize instructions = 本能力的 system-prompt
// fragment（自包含：prompt 由 server 自己声明，不写在 core）。instructions 是 server
// 级静态，lazy 拨号读一次缓存；deterministic（同 server 同文本），不每次装配重拨。
// 首个调用方的 ctx 决定这次一次性拨号。
func (c *mcpAppCapability) cachedInstructions(ctx context.Context) string {
	c.instrOnce.Do(func() {
		// instructions 读取是无 session 的一次性拨号 → 不分配工作区（workspaceDir 空）。
		sess, err := dialMCPApp(ctx, &c.m, "")
		if err != nil {
			return
		}
		defer sess.Close()
		*c.instr = sess.Instructions()
	})
	return *c.instr
}

// mcpAppGranted —— 暴露门。ACL=always → 无条件暴露给所有 mode（外置的内建基础
// 能力，如 ask_visitor）。否则 role-granted：role 的 AllowedTools 含本插件 ID 才暴露
// （echoer / 第三方 server），无 role(public/byoai) → 隐藏。
func mcpAppGranted(m *mcpplugin.Manifest, snap *access.RoleSnapshot) bool {
	always := m.ACL == mcpplugin.ACLAlways
	if snap == nil {
		return always // 无 snapshot：没 code deny 来源，只 always 能力暴露
	}
	// frozen 三层判定（global 活闸在 enabledCaps 另算）。code deny 含在内。
	return snap.AllowsCapability(m.ID, always)
}

// sessionMetaFor / roleIDOf / maxBookingsOf / corpusScopeOf —— 见
// capreg_mcp_app_session.go(从此文件拆出,守 max-lines ≤350)。
