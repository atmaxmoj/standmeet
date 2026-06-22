// capreg_mcp_app_state.go —— mcpAppCapability 的 tool-wrapping + CapabilityState 子关注：
// 把 dial 出来的 MCP tool 包成 capreg.BindingTool，组装 CapabilityState（id/enabled/ui +
// stateHook overlay）。从 capreg_mcp_app.go 拆出来守 max-lines 350 cap。

package usecases

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

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

// overlayCapState —— 把 stateHook 算出来的非零字段叠到通用 state 上（id/enabled 不动）。
func overlayCapState(dst *capreg.CapabilityState, extra capreg.CapabilityState) {
	if extra.QuotaRemaining != nil {
		dst.QuotaRemaining = extra.QuotaRemaining
	}
	if extra.PolicySummary != "" {
		dst.PolicySummary = extra.PolicySummary
	}
	if len(extra.Extra) > 0 {
		dst.Extra = extra.Extra
	}
}

// mcpAppState —— CapabilityState；manifest 带 ui 则把 ui 资源（resource_uri /
// mime_type + 装配期读到的 HTML 模板）挂进 Extra（#134：前端沙盒渲染的取料）。
func mcpAppState(
	ctx context.Context, sess *mcpclient.Session, m *mcpplugin.Manifest, enabled bool,
) capreg.CapabilityState {
	st := capreg.CapabilityState{ID: m.ID, Enabled: enabled}
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
