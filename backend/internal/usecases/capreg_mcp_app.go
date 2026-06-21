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
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
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

func (c *mcpAppCapability) SystemPromptFragmentID(
	ctx context.Context, _ *capreg.AssembleInput,
) string {
	if c.cachedInstructions(ctx) == "" {
		return ""
	}
	return "mcpapp/" + c.m.ID
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
		Tools: wrapMCPAppTools(&c.m, sess, tools),
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

// dialMCPApp —— 按 transport kind 选 stdio / http / in_process。三类走同一条 dial
// 入口（归一），只是底层 transport 不同：in_process 内存直连同进程 server 对象。
// 错误被 VisitorBinding 收成 ErrHidden,这里只负责 dial。
func dialMCPApp(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	switch t.Kind {
	case mcpplugin.TransportStdio:
		sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
		return sess, wrapDial(err)
	case mcpplugin.TransportHTTP:
		sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
		return sess, wrapDial(err)
	case mcpplugin.TransportInProcess:
		sess, err := mcpclient.DialInProcess(ctx, t.InProcessServer)
		return sess, wrapDial(err)
	default:
		return nil, fmt.Errorf("plugin: unknown transport kind %q", t.Kind)
	}
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

func wrapMCPAppTools(
	m *mcpplugin.Manifest, sess *mcpclient.Session, tools []mcpclient.Tool,
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
			makeExtMCPRun(sess, t.Name),
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
