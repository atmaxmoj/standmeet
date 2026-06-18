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
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

type mcpAppCapability struct {
	m mcpplugin.Manifest
}

func newMCPAppCapability(m *mcpplugin.Manifest) *mcpAppCapability {
	return &mcpAppCapability{m: *m}
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

// VisitorBinding —— dial 插件 → list → wrap。dial / list 失败 / 空 tool → 隐藏。
func (c *mcpAppCapability) VisitorBinding(
	ctx context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
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
		State: mcpAppState(&c.m),
		Close: sess.Close,
	}, nil
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
	clean := skillToolNameRe.ReplaceAllString(pluginID+"_"+tool, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}

func mcpAppToolDescription(pluginID string, t *mcpclient.Tool) string {
	prefix := "[" + pluginID + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// mcpAppState —— CapabilityState；manifest 带 ui 则把 ui 挂进 Extra(#134 接点)。
func mcpAppState(m *mcpplugin.Manifest) capreg.CapabilityState {
	st := capreg.CapabilityState{ID: m.ID, Enabled: true}
	if m.UI == nil {
		return st
	}
	extra, err := json.Marshal(map[string]map[string]string{
		"ui": {"resource_uri": m.UI.ResourceURI, "mime_type": m.UI.MimeType},
	})
	if err == nil {
		st.Extra = extra
	}
	return st
}
