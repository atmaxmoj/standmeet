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

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

type mcpAppCapability struct {
	m mcpplugin.Manifest
}

func newMCPAppCapability(m *mcpplugin.Manifest) *mcpAppCapability {
	return &mcpAppCapability{m: *m}
}

// RegisterDiscoveredPlugins —— 把发现来源(装机配置)的 manifest 逐个注册成
// mcpAppCapability 进同一个 Registry。装机插件不是随产品发的内建，而是部署期
// 声明装上的 —— origin=managed(P.5/P.6)：管理面据此分组、且 managed 不可经面板删
// (删 = 改装机配置，不是运行期删)。撞 ID(跟内建或彼此) → 跳过该条、收进返回的
// skipped(caller log),不让一个坏插件 panic 整个 boot。
func RegisterDiscoveredPlugins(reg *capreg.Registry, manifests []mcpplugin.Manifest) []string {
	skipped := []string{}
	for i := range manifests {
		err := reg.RegisterOrigin(newMCPAppCapability(&manifests[i]), capreg.OriginManaged)
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

func (*mcpAppCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

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
	if !mcpAppGranted(in.RoleSnapshot, c.m.ID) {
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
		Tools: wrapMCPAppTools(c.m.ID, sess, tools),
		State: mcpAppState(ctx, sess, &c.m),
		Close: sess.Close,
	}, nil
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

// dialMCPApp —— 按 transport kind 选 stdio / http。manifest 已过校验,kind 必是
// 两者之一;default 防御。错误被 VisitorBinding 收成 ErrHidden,这里只负责 dial。
func dialMCPApp(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	switch t.Kind {
	case "stdio":
		sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
		return sess, wrapDial(err)
	case "http":
		sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
		return sess, wrapDial(err)
	default:
		return nil, fmt.Errorf("plugin: unknown transport kind %q", t.Kind)
	}
}

// mcpAppGranted —— role 的 AllowedTools 含本插件 ID 才暴露(ACL,跟 booking /
// ext-mcp 同套路:基础 role-grant 授权;Phase D/H 再统一进 interceptor + 管理面)。
// 无 role(public / byoai)→ 不授权 → 隐藏。
func mcpAppGranted(snap *domain.RoleSnapshot, id string) bool {
	if snap == nil {
		return false
	}
	return slices.Contains(snap.AllowedTools(), id)
}

func wrapDial(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("plugin dial: %w", err)
}

func wrapMCPAppTools(
	pluginID string, sess *mcpclient.Session, tools []mcpclient.Tool,
) []capreg.BindingTool {
	out := make([]capreg.BindingTool, 0, len(tools))
	for i := range tools {
		t := &tools[i]
		name := composeMCPAppToolName(pluginID, t.Name)
		if name == "" {
			continue
		}
		out = append(out, capreg.NewTool(
			name,
			mcpAppToolDescription(pluginID, t),
			"calling plugin",
			t.InputSchema,
			makeExtMCPRun(sess, t.Name),
		))
	}
	return out
}

func composeMCPAppToolName(pluginID, tool string) string {
	return sanitizeToolName(pluginID + "_" + tool)
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
