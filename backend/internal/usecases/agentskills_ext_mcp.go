// agentskills_ext_mcp.go —— Phase B-3: extMCPCapability。
// owner 在 admin 注册的外部 MCP server (URL + auth) 在 visitor session 装配
// 时被并发 dial，每 server.ListTools 暴露成 ext_<server>_<tool>；执行走
// session.CallTool。session 在 Binding.Close 里释放，dial/close 计数进
// agentskills.ExtMCP{Dialed,Closed}。
//
// Shape=visitor_only；owner 通过自己的 MCP 客户端跟外部 server 直连，不
// 走 standmeet 转发。

package usecases

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/cryptobox"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/mcpclient"
)

const (
	capExtMCP     = "ext.mcp"
	extToolPrefix = "ext_"
)

type extMCPCapability struct {
	deps *VisitorDeps
}

func newExtMCPCapability(deps *VisitorDeps) *extMCPCapability {
	return &extMCPCapability{deps: deps}
}

func (*extMCPCapability) ID() string { return capExtMCP }
func (*extMCPCapability) Shape() agentskills.Shape {
	return agentskills.ShapeVisitorOnly
}

func (*extMCPCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{}
}

func (*extMCPCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— role.MCPServerIDs 解算 → 并发 dial → ListTools →
// Tools[]。任一 server dial / ListTools 失败 silently skip (log + 不阻塞
// 整 chat)。Close hook 释放所有 session + 更新计数。
func (c *extMCPCapability) VisitorBinding(
	ctx context.Context, in *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	servers := loadMCPServersForRole(ctx, c.deps, in)
	if len(servers) == 0 {
		return nil, agentskills.ErrHidden
	}
	bundle := dialExternalMCPs(ctx, servers)
	if len(bundle.tools) == 0 {
		bundle.closeAll()
		return nil, agentskills.ErrHidden
	}
	return &agentskills.Binding{
		Tools: bundle.tools,
		State: agentskills.CapabilityState{ID: capExtMCP, Enabled: true},
		Close: bundle.closeAll,
	}, nil
}

func loadMCPServersForRole(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
) []domain.MCPServerConfig {
	if deps.MCPServers == nil || in.RoleSnapshot == nil {
		return []domain.MCPServerConfig{}
	}
	ids := in.RoleSnapshot.MCPServerIDs()
	out := make([]domain.MCPServerConfig, 0, len(ids))
	for _, id := range ids {
		cfg, err := deps.MCPServers.GetByID(ctx, in.OwnerID, id)
		if err != nil {
			continue
		}
		out = append(out, cfg)
	}
	return out
}

// extMCPBundle —— 一次 dial 出来的 session + tools 打包，让 Close hook 闭包
// 持有引用，VisitorBinding 拿到 tools 列表给 LLM。
type extMCPBundle struct {
	tools    []agentskills.BindingTool
	sessions []*mcpclient.Session
}

func (b *extMCPBundle) closeAll() {
	for _, s := range b.sessions {
		s.Close()
		agentskills.ExtMCPClosed()
	}
	b.sessions = nil
}

func dialExternalMCPs(
	ctx context.Context, servers []domain.MCPServerConfig,
) *extMCPBundle {
	bundle := &extMCPBundle{}
	results := dialAllInParallel(ctx, servers)
	for i := range results {
		bundle.absorb(servers[i].Name, &results[i])
	}
	return bundle
}

type dialResult struct {
	err     error
	session *mcpclient.Session
	tools   []mcpclient.Tool
}

func dialAllInParallel(
	ctx context.Context, servers []domain.MCPServerConfig,
) []dialResult {
	out := make([]dialResult, len(servers))
	var wg sync.WaitGroup
	for i := range servers {
		wg.Go(func() {
			out[i] = dialOne(ctx, &servers[i])
		})
	}
	wg.Wait()
	return out
}

func dialOne(ctx context.Context, cfg *domain.MCPServerConfig) dialResult {
	headers, herr := buildAuthHeaders(cfg)
	if herr != nil {
		return dialResult{err: herr}
	}
	sess, derr := mcpclient.Dial(ctx, cfg.URL, headers)
	if derr != nil {
		return dialResult{err: derr}
	}
	tools, terr := sess.ListTools(ctx)
	if terr != nil {
		sess.Close()
		return dialResult{err: terr}
	}
	agentskills.ExtMCPDialed()
	return dialResult{session: sess, tools: tools}
}

func buildAuthHeaders(cfg *domain.MCPServerConfig) (map[string]string, error) {
	if cfg.AuthHeaderName == "" || len(cfg.AuthHeaderValueEnc) == 0 {
		return map[string]string{}, nil
	}
	plain, err := cryptobox.Decrypt(cfg.AuthHeaderValueEnc)
	if err != nil {
		return nil, fmt.Errorf("decrypt mcp auth: %w", err)
	}
	return map[string]string{cfg.AuthHeaderName: string(plain)}, nil
}

func (b *extMCPBundle) absorb(serverName string, r *dialResult) {
	if r.err != nil || r.session == nil {
		return
	}
	b.sessions = append(b.sessions, r.session)
	for i := range r.tools {
		t := &r.tools[i]
		toolName := composeExtToolName(serverName, t.Name)
		if toolName == "" {
			continue
		}
		b.tools = append(b.tools, agentskills.BindingTool{
			Spec: inference.ToolSpec{
				Name:        toolName,
				Description: extToolDescription(serverName, t),
				InputSchema: t.InputSchema,
			},
			Execute: makeExtMCPExecutor(r.session, t.Name),
		})
	}
}

func composeExtToolName(server, tool string) string {
	raw := extToolPrefix + server + "_" + tool
	clean := skillToolNameRe.ReplaceAllString(raw, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}

func extToolDescription(server string, t *mcpclient.Tool) string {
	prefix := "[" + server + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// makeExtMCPExecutor —— CallTool 失败时不让 inference 整 abort —— 把 err
// 包成 errJSON 进 tool_result，AI 看到"外部工具失败"自己换路。
func makeExtMCPExecutor(session *mcpclient.Session, realToolName string) inference.ToolExecutor {
	return func(ctx context.Context, _ string, input []byte) (string, error) {
		return extCallToToolResult(session.CallTool(ctx, realToolName, input))
	}
}

// extCallToToolResult —— CallTool err 折成 errJSON tool_result，让 SDK
// continue 而非 abort (Go-side err 永远 nil 是 ToolExecutor 契约)。
//
// 故意 nil 让 inference SDK 继续 agent loop 而不 abort 整个 stream。
//
//nolint:nilerr // tool-result envelope: err 进 JSON text，Go err return
func extCallToToolResult(out string, err error) (string, error) {
	if err != nil {
		return errJSON("external mcp tool: " + err.Error()), nil
	}
	return out, nil
}
