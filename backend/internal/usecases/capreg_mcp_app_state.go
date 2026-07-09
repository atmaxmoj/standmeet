// capreg_mcp_app_state.go —— mcpAppCapability 的 tool-wrapping + CapabilityState 子关注：
// 把 dial 出来的 MCP tool 包成 capreg.BindingTool，组装 CapabilityState（id/enabled/ui +
// stateHook overlay）。从 capreg_mcp_app.go 拆出来守 max-lines 350 cap。

package usecases

import (
	"context"
	"log/slog"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
)

func wrapMCPAppTools(
	ctx context.Context, m *mcpplugin.Manifest, sess *mcpclient.Session,
	tools []mcpclient.Tool, sessionMeta *mcpclient.SessionContext,
) []capreg.BindingTool {
	out := make([]capreg.BindingTool, 0, len(tools))
	uiCache := map[string]string{} // per-assembly dedup of resources/read（同 uri 只读一次）
	for i := range tools {
		t := &tools[i]
		name := composeMCPAppToolName(m, t.Name)
		if name == "" {
			continue
		}
		bt := capreg.NewTool(
			name,
			mcpAppToolDescription(m.ID, t),
			toolProgressLabel(t),
			t.InputSchema,
			makeExtMCPRun(sess, t.Name, sessionMeta),
		)
		// ReturnDirectly —— server 经 tool `_meta.return_directly` 声明：调完直接
		// 结束 agent loop，把 result 当 final 推浏览器（ask_visitor 那套语义）。
		if toolReturnsDirectly(t) {
			bt.ReturnDirectly = true
		}
		// UIHTML —— MCP Apps：ui 挂 tool（`_meta.ui_resource`）。装配时读卡片 HTML。
		bt.UIHTML = toolUIHTML(ctx, sess, t, uiCache)
		// ReadOnly —— server 的 `annotations.readOnlyHint`：安全读工具可走 HTTP QUERY。
		bt.ReadOnly = t.ReadOnly
		out = append(out, bt)
	}
	return out
}

// toolReturnsDirectly —— 读 server 在 tool `_meta` 里声明的 return_directly。
func toolReturnsDirectly(t *mcpclient.Tool) bool {
	v, ok := t.Meta["return_directly"].(bool)
	return ok && v
}

// toolUIHTML —— 读 tool `_meta.ui_resource` 指向的 ui:// 卡片 HTML（per-tool，对齐
// MCP Apps）。无声明 → 空（无卡）；读不到 → 空（降级，不阻塞 chat）。同 uri 走 cache。
func toolUIHTML(
	ctx context.Context, sess *mcpclient.Session, t *mcpclient.Tool, cache map[string]string,
) string {
	uri, ok := t.Meta["ui_resource"].(string)
	if !ok || uri == "" {
		return ""
	}
	if html, hit := cache[uri]; hit {
		return html
	}
	html, err := sess.ReadResource(ctx, uri)
	if err != nil {
		// 读不到不致命（card 降级，不阻塞 chat），但记一笔——不静默吞。
		slog.Default().Warn("read ui card resource", "tool", t.Name, "uri", uri, "err", err)
		return ""
	}
	cache[uri] = html
	return html
}

// toolProgressLabel —— server 在 tool `_meta.progress_label` 里声明的 throbber 文案
// （外置内建保各自原文案：corpus_search "searching corpus" 等）。未声明 → 通用兜底。
func toolProgressLabel(t *mcpclient.Tool) string {
	if v, ok := t.Meta["progress_label"].(string); ok && v != "" {
		return v
	}
	return "calling plugin"
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
func overlayCapState(dst, extra *capreg.CapabilityState) {
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

// mcpAppState —— 通用 CapabilityState（id/enabled）。#134：ui 卡片已挪到 per-tool
// （tool `_meta.ui_resource` → tool_spec.UIHTML），不再挂在 capability 上。
func mcpAppState(m *mcpplugin.Manifest, enabled bool) capreg.CapabilityState {
	return capreg.CapabilityState{ID: m.ID, Enabled: enabled}
}
