// capreg_mcp_app.go —— C3: mcpAppCapability 适配器(泛化 ext-mcp)。
//
// 这是 **MCP app(能力)** 那一类 —— 不是 skill。把一条 mcpplugin.Manifest dial
// 成一个 MCP server、ListTools、每个 tool 包成 BindingTool(register 式)。skill
// (Agent Skills / SKILL.md 内容库)是完全不同的另一类(Phase C),不在这。
//
// VisitorBinding 时按 transport dial → ListTools → 包 BindingTool;_meta.ui 进
// CapabilityState.Extra。dial / list 失败 / 空 tool → ErrHidden(隐藏,不阻塞
// chat)。tool 调用失败折成 errJSON(复用 ext-mcp 的 makeExtMCPRun)。

package usecases

import (
	"context"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
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
	m            mcpplugin.Manifest
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

// RegisterDiscoveredPlugins —— 把发现来源的 manifest 逐个注册成 mcpAppCapability
// 进同一个 Registry，带指定 origin：
//   - OriginBuiltin：随产品镜像发的 bundled 内建（外置后的 ask_visitor 等）。这条源
//     prod 也在；管理面不可删（删 = 改镜像）。
//   - OriginManaged：部署期经 STANDMEET_PLUGINS 声明装上的第三方/集成插件。
//
// 撞 ID(跟别的内建或彼此) → 跳过该条、收进返回的 skipped(caller log),不让一个坏
// 插件 panic 整个 boot。
func RegisterDiscoveredPlugins(
	reg *capreg.Registry, manifests []mcpplugin.Manifest, origin capreg.Origin,
) []string {
	return RegisterDiscoveredPluginsHooked(reg, manifests, origin, nil)
}

// RegisterDiscoveredPluginsHooked —— RegisterDiscoveredPlugins + 给特定 ID 的插件挂
// per-session 钩子（CapHooks）。由 composition root 注入（连接器 proxy / store / corpus
// scope 都在那）：booker 用 Gate 做 connector+quota 的 tool 隐藏；retrieval 用 Fragment
// 做 corpus-scope 的 prompt/enabled 闸。hooks 为 nil / 无此 ID → 无额外钩子（默认）。
func RegisterDiscoveredPluginsHooked(
	reg *capreg.Registry, manifests []mcpplugin.Manifest, origin capreg.Origin,
	hooks map[string]CapHooks,
) []string {
	skipped := []string{}
	for i := range manifests {
		appCap := newMCPAppCapability(&manifests[i])
		if h, ok := hooks[manifests[i].ID]; ok {
			appCap.gate = h.Gate
			appCap.fragmentGate = h.Fragment
			appCap.stateHook = h.State
		}
		if err := reg.RegisterOrigin(appCap, origin); err != nil {
			skipped = append(skipped, manifests[i].ID)
		}
	}
	return skipped
}

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

func (*mcpAppCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

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
	ds, derr := dialAndList(ctx, &c.m.Transport, provisionWorkspaceFor(&c.m, in.ConversationID))
	if derr != nil {
		return nil, derr
	}
	specs := c.cachedToolSpecs(ds.tools)
	return &capreg.Binding{
		Tools: wrapMCPAppTools(ctx, &c.m, ds.sess, specs, sessionMetaFor(&c.m, in)),
		State: c.stateFor(ctx, in),
		Close: ds.sess.Close,
	}, nil
}

// cachedToolSpecs —— 首拨缓存 tool specs（含 _meta），之后恒返缓存：tool 元数据是静态
// 的，缓存住就不会被某次冷启高负载的 ListTools 把 return_directly/progress_label 丢掉。
// 执行仍走本次 dial 的 live session（tool name 一致），只有 specs 取缓存。
func (c *mcpAppCapability) cachedToolSpecs(dialed []mcpclient.Tool) []mcpclient.Tool {
	c.toolsOnce.Do(func() { *c.tools = dialed })
	return *c.tools
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
	ctx context.Context, t *mcpplugin.Transport, workspaceDir string,
) (*dialedApp, error) {
	sess, err := dialMCPApp(ctx, t, workspaceDir)
	if err != nil {
		return nil, capreg.ErrHidden
	}
	tools, lerr := sess.ListTools(ctx)
	if lerr != nil || len(tools) == 0 {
		sess.Close()
		return nil, capreg.ErrHidden
	}
	return &dialedApp{sess: sess, tools: tools}, nil
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
		sess, err := dialMCPApp(ctx, &c.m.Transport, "")
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
func mcpAppGranted(m *mcpplugin.Manifest, snap *domain.RoleSnapshot) bool {
	always := m.ACL == mcpplugin.ACLAlways
	if snap == nil {
		return always // 无 snapshot：没 code deny 来源，只 always 能力暴露
	}
	// frozen 三层判定（global 活闸在 enabledCaps 另算）。code deny 含在内。
	return snap.AllowsCapability(m.ID, always)
}

// sessionMetaFor —— 数据型内建（manifest 声明了 HostSockets）才拿到可信 session
// 上下文，经 tool-call `_meta` 递给它自己的沙箱 server（再转给宿主窄 socket API）。
// ask_visitor / 第三方插件无 HostSockets → 返 nil，拿不到 session 上下文（防泄漏）。
func sessionMetaFor(m *mcpplugin.Manifest, in *capreg.AssembleInput) *mcpclient.SessionContext {
	if m.Transport.Sandbox == nil || len(m.Transport.Sandbox.HostSockets) == 0 {
		return nil
	}
	return &mcpclient.SessionContext{
		OwnerID:        in.OwnerID,
		CodeID:         in.CodeID,
		ConversationID: in.ConversationID,
		Mode:           in.Mode,
		VisitorName:    in.Visitor.Name,
		VisitorEmail:   in.Visitor.Email,
		RoleID:         roleIDOf(in),
		CorpusURIs:     corpusURIsOf(in),
	}
}

// roleIDOf —— 当前 session 的 role id（booker owner-notify 的 per-role 开关要）。
// 无 role(public/byoai) → 空串。
func roleIDOf(in *capreg.AssembleInput) string {
	if in.RoleSnapshot == nil {
		return ""
	}
	return in.RoleSnapshot.RoleID()
}

// corpusURIsOf —— 当前 session 的 corpus-ACL scope（role snapshot 的 URI glob 白名单），
// 给外置 retrieval 插件的 host op 重建 AllowsCorpus 用。无 role → 空（无 scope）。
func corpusURIsOf(in *capreg.AssembleInput) []string {
	if in.RoleSnapshot == nil {
		return []string{}
	}
	return in.RoleSnapshot.CorpusURIs()
}
