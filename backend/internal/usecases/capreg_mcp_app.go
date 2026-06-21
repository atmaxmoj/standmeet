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
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
)

type mcpAppCapability struct {
	instrOnce *sync.Once
	instr     *string
	m         mcpplugin.Manifest
}

func newMCPAppCapability(m *mcpplugin.Manifest) *mcpAppCapability {
	return &mcpAppCapability{m: *m, instrOnce: &sync.Once{}, instr: new(string)}
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
	skipped := []string{}
	for i := range manifests {
		err := reg.RegisterOrigin(newMCPAppCapability(&manifests[i]), origin)
		if err != nil {
			skipped = append(skipped, manifests[i].ID)
		}
	}
	return skipped
}

func (c *mcpAppCapability) ID() string { return c.m.ID }

func (c *mcpAppCapability) Shape() capreg.Shape {
	return capreg.Shape(string(c.m.Shape))
}

func (*mcpAppCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (c *mcpAppCapability) SystemPromptFragment(
	ctx context.Context, _ *capreg.AssembleInput,
) string {
	return c.cachedInstructions(ctx)
}

// SystemPromptFragmentID —— 空。mcp-app 的 prompt 是 server 的 initialize
// instructions（inline 文本，经 SystemPromptFragment 进 ComposeSystemPrompt），
// **不是**一个可加载的 prompt 文件 id。返非空会让"按 part-id 加载 prompt 文件"那条
// 路径走 prompts.load("mcpapp/<id>") → 404，拖垮整个 agent turn。
func (*mcpAppCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— ACL gate(role 授权)→ dial → list → wrap。未授权 / dial /
// list 失败 / 空 tool → 隐藏。先查授权再 dial(省掉没授权还白拨的开销)。
func (c *mcpAppCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	if !mcpAppGranted(&c.m, in.RoleSnapshot) {
		return nil, capreg.ErrHidden
	}
	sess, err := dialMCPApp(ctx, &c.m.Transport)
	if err != nil {
		return nil, capreg.ErrHidden
	}
	tools, lerr := sess.ListTools(ctx)
	if lerr != nil || len(tools) == 0 {
		sess.Close()
		return nil, capreg.ErrHidden
	}
	return &capreg.Binding{
		Tools: wrapMCPAppTools(&c.m, sess, tools, sessionMetaFor(&c.m, in)),
		State: mcpAppState(ctx, sess, &c.m),
		Close: sess.Close,
	}, nil
}

// cachedInstructions —— server 的 initialize instructions = 本能力的 system-prompt
// fragment（自包含：prompt 由 server 自己声明，不写在 core）。instructions 是 server
// 级静态，lazy 拨号读一次缓存；deterministic（同 server 同文本），不每次装配重拨。
// 首个调用方的 ctx 决定这次一次性拨号。
func (c *mcpAppCapability) cachedInstructions(ctx context.Context) string {
	c.instrOnce.Do(func() {
		sess, err := dialMCPApp(ctx, &c.m.Transport)
		if err != nil {
			return
		}
		defer sess.Close()
		*c.instr = sess.Instructions()
	})
	return *c.instr
}

// readUIHTML —— manifest 带 ui 时，装配期经 resources/read 取卡片 HTML 模板。
// 取不到不致命（card 渲染降级，不阻塞 chat）：返空串、caller 仍带 resource_uri。
func readUIHTML(ctx context.Context, sess *mcpclient.Session, m *mcpplugin.Manifest) string {
	if m.UI == nil || m.UI.ResourceURI == "" {
		return ""
	}
	html, err := sess.ReadResource(ctx, m.UI.ResourceURI)
	if err != nil {
		return ""
	}
	return html
}

// transportDialers —— 每种 transport 一个拨号器，dialMCPApp 查表分发（归一：四类
// 走同一入口，只是底层不同）。in_process 内存直连同进程 server；sandbox_stdio 经
// bwrap 隔离起第三方 server。
var transportDialers = map[string]func(
	context.Context, *mcpplugin.Transport,
) (*mcpclient.Session, error){
	mcpplugin.TransportStdio:        dialStdio,
	mcpplugin.TransportHTTP:         dialHTTP,
	mcpplugin.TransportInProcess:    dialInProcess,
	mcpplugin.TransportSandboxStdio: dialSandboxStdio,
}

// dialMCPApp —— 查 transportDialers 分发。未知 kind → error。错误被 VisitorBinding
// 收成 ErrHidden,这里只负责 dial。
func dialMCPApp(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	d, ok := transportDialers[t.Kind]
	if !ok {
		return nil, fmt.Errorf("plugin: unknown transport kind %q", t.Kind)
	}
	return d(ctx, t)
}

func dialStdio(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
	return sess, wrapDial(err)
}

func dialHTTP(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
	return sess, wrapDial(err)
}

func dialInProcess(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialInProcess(ctx, t.InProcessServer)
	return sess, wrapDial(err)
}

// dialSandboxStdio —— 主进程把第三方 server 起在 bubblewrap 隔离环境里（只读 host
// 运行时 + 只读插件代码 + per-session workspace + tmpfs /tmp + 默认无网，碰不了
// host）；stdio 透明走 bwrap 的 stdin/stdout，dial 仍是普通 DialStdio，只是命令被包
// 了一层 `bwrap`。
func dialSandboxStdio(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	argv, aerr := sandboxStdioArgv(t)
	if aerr != nil {
		return nil, wrapDial(aerr)
	}
	sess, derr := mcpclient.DialStdio(ctx, "bwrap", argv, t.Env)
	return sess, wrapDial(derr)
}

// sandboxStdioArgv —— 把 manifest 的沙箱声明 + 容器内启动命令拼成 `bwrap ...` argv
// （只读 host 运行时 / 只读插件代码 / tmpfs / 网络策略），交给 DialStdio。
func sandboxStdioArgv(t *mcpplugin.Transport) ([]string, error) {
	if t.Sandbox == nil {
		return nil, errors.New("plugin: sandbox_stdio missing sandbox config")
	}
	launch := &sandbox.StdioLaunch{
		CodeDir: t.Sandbox.PluginDir, // 插件代码（MinIO materialize 出来的只读 artifact）
		// WorkspaceDir 暂空 —— per-session 懒建工作区接 session 上下文时再填（#148）。
		WorkspaceDir: "",
		Command:      t.Command,
		Args:         t.Args,
		AllowNet:     t.Sandbox.AllowNet,
		HostSockets:  t.Sandbox.HostSockets, // 数据型内建的窄 socket（断网也可达）
	}
	argv, err := launch.BwrapArgv()
	if err != nil {
		return nil, fmt.Errorf("plugin: build sandbox argv: %w", err)
	}
	return argv, nil
}

// mcpAppGranted —— 暴露门。ACL=always → 无条件暴露给所有 mode（外置的内建基础
// 能力，如 ask_visitor）。否则 role-granted：role 的 AllowedTools 含本插件 ID 才暴露
// （echoer / 第三方 server），无 role(public/byoai) → 隐藏。
func mcpAppGranted(m *mcpplugin.Manifest, snap *domain.RoleSnapshot) bool {
	if m.ACL == mcpplugin.ACLAlways {
		return true
	}
	if snap == nil {
		return false
	}
	return slices.Contains(snap.AllowedTools(), m.ID)
}

func wrapDial(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("plugin dial: %w", err)
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
		VisitorName:    in.Visitor.Name,
		VisitorEmail:   in.Visitor.Email,
	}
}

func wrapMCPAppTools(
	m *mcpplugin.Manifest, sess *mcpclient.Session, tools []mcpclient.Tool,
	sessionMeta *mcpclient.SessionContext,
) []capreg.BindingTool {
	out := make([]capreg.BindingTool, 0, len(tools))
	for i := range tools {
		t := &tools[i]
		name := composeMCPAppToolName(m, t.Name)
		if name == "" {
			continue
		}
		bt := capreg.NewTool(
			name,
			mcpAppToolDescription(m.ID, t),
			"calling plugin",
			t.InputSchema,
			makeExtMCPRun(sess, t.Name, sessionMeta),
		)
		// ReturnDirectly —— server 经 tool `_meta.return_directly` 声明：调完直接
		// 结束 agent loop，把 result 当 final 推浏览器（ask_visitor 那套语义）。
		if toolReturnsDirectly(t) {
			bt.ReturnDirectly = true
		}
		out = append(out, bt)
	}
	return out
}

// toolReturnsDirectly —— 读 server 在 tool `_meta` 里声明的 return_directly。
func toolReturnsDirectly(t *mcpclient.Tool) bool {
	v, ok := t.Meta["return_directly"].(bool)
	return ok && v
}

// composeMCPAppToolName —— RawToolNames 时用 server 原名（外置内建保 canonical
// 名）；否则加 <id>_ 前缀（多个第三方 server 防撞名）。
func composeMCPAppToolName(m *mcpplugin.Manifest, tool string) string {
	if m.RawToolNames {
		return sanitizeToolName(tool)
	}
	return sanitizeToolName(m.ID + "_" + tool)
}

func mcpAppToolDescription(pluginID string, t *mcpclient.Tool) string {
	prefix := "[" + pluginID + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// mcpAppState —— CapabilityState；manifest 带 ui 则把 ui 资源（resource_uri /
// mime_type + 装配期读到的 HTML 模板）挂进 Extra（#134：前端沙盒渲染的取料）。
func mcpAppState(
	ctx context.Context, sess *mcpclient.Session, m *mcpplugin.Manifest,
) capreg.CapabilityState {
	st := capreg.CapabilityState{ID: m.ID, Enabled: true}
	if m.UI == nil {
		return st
	}
	extra, err := json.Marshal(map[string]map[string]string{
		"ui": {
			"resource_uri": m.UI.ResourceURI,
			"mime_type":    m.UI.MimeType,
			"html":         readUIHTML(ctx, sess, m),
		},
	})
	if err == nil {
		st.Extra = extra
	}
	return st
}
