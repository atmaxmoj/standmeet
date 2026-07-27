// capreg_ext_mcp.go —— Phase B-3: extMCPCapability。
// owner 在 admin 注册的外部 MCP server (URL + auth) 在 visitor session 装配
// 时被并发 dial，每 server.ListTools 暴露成 ext_<server>_<tool>；执行走
// session.CallTool。session 在 Binding.Close 里释放，dial/close 计数进
// capreg.ExtMCP{Dialed,Closed}。
//
// Shape=visitor_only；owner 通过自己的 MCP 客户端跟外部 server 直连，不
// 走 standmeet 转发。

package usecases

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/marketplace"
	"github.com/atmaxmoj/standmeet/internal/mcpclient"
)

const (
	capExtMCP     = "ext.mcp"
	extToolPrefix = "ext_"
)

// extMCPCapability —— 窄依赖(#131):owner 注册的外部 MCP server 目录 + connector-dep
// 连通查询（ext-mcp 工具声明 _meta.requires 时按 grant+connected 闸，见 _deps.go）。
type extMCPCapability struct {
	servers   conversation.MCPServerGetter
	connected DepConnected
}

func newExtMCPCapability(
	servers conversation.MCPServerGetter, connected DepConnected,
) *extMCPCapability {
	return &extMCPCapability{servers: servers, connected: connected}
}

func (*extMCPCapability) ID() string { return capExtMCP }
func (*extMCPCapability) Shape() capreg.Shape {
	return capreg.ShapeVisitorOnly
}

func (*extMCPCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (*extMCPCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*extMCPCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— role.MCPServerIDs 解算 → 并发 dial → ListTools →
// Tools[]。任一 server dial / ListTools 失败 silently skip (log + 不阻塞
// 整 chat)。Close hook 释放所有 session + 更新计数。
func (c *extMCPCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	servers := loadMCPServersForRole(ctx, c.servers, in)
	if len(servers) == 0 {
		return nil, capreg.ErrHidden
	}
	bundle := dialExternalMCPs(ctx, servers, c.connected)
	if len(bundle.tools) == 0 {
		bundle.closeAll()
		return nil, capreg.ErrHidden
	}
	return &capreg.Binding{
		Tools: bundle.tools,
		State: capreg.CapabilityState{ID: capExtMCP, Enabled: true},
		Close: bundle.closeAll,
	}, nil
}

func loadMCPServersForRole(
	ctx context.Context, servers conversation.MCPServerGetter, in *capreg.AssembleInput,
) []marketplace.MCPServerConfig {
	if servers == nil || in.RoleSnapshot == nil {
		return []marketplace.MCPServerConfig{}
	}
	ids := in.RoleSnapshot.MCPServerIDs()
	out := make([]marketplace.MCPServerConfig, 0, len(ids))
	for _, id := range ids {
		cfg, err := servers.GetByID(ctx, in.OwnerID, id)
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
	tools    []capreg.BindingTool
	sessions []*mcpclient.Session
}

func (b *extMCPBundle) closeAll() {
	for _, s := range b.sessions {
		s.Close()
		capreg.ExtMCPClosed()
	}
	b.sessions = nil
}

func dialExternalMCPs(
	ctx context.Context, servers []marketplace.MCPServerConfig, connected DepConnected,
) *extMCPBundle {
	bundle := &extMCPBundle{}
	results := dialAllInParallel(ctx, servers)
	for i := range results {
		bundle.absorb(ctx, &servers[i], connected, &results[i])
	}
	return bundle
}

type dialResult struct {
	err     error
	session *mcpclient.Session
	tools   []mcpclient.Tool
}

func dialAllInParallel(
	ctx context.Context, servers []marketplace.MCPServerConfig,
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

func dialOne(ctx context.Context, cfg *marketplace.MCPServerConfig) dialResult {
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
	capreg.ExtMCPDialed()
	return dialResult{session: sess, tools: tools}
}

func buildAuthHeaders(cfg *marketplace.MCPServerConfig) (map[string]string, error) {
	if cfg.AuthHeaderName == "" || len(cfg.AuthHeaderValueEnc) == 0 {
		return map[string]string{}, nil
	}
	plain, err := cryptobox.Decrypt(cfg.AuthHeaderValueEnc, []byte(cfg.OwnerID))
	if err != nil {
		return nil, fmt.Errorf("decrypt mcp auth: %w", err)
	}
	return map[string]string{cfg.AuthHeaderName: string(plain)}, nil
}

func (b *extMCPBundle) absorb(
	ctx context.Context, cfg *marketplace.MCPServerConfig, connected DepConnected, r *dialResult,
) {
	if r.err != nil || r.session == nil {
		return
	}
	b.sessions = append(b.sessions, r.session)
	for i := range r.tools {
		b.addTool(ctx, cfg, connected, r.session, &r.tools[i])
	}
}

// addTool —— 暴露一个 ext-mcp 工具，先过 connector-dep 闸（ext-mcp 最低信任，见 _deps.go）：
// 工具声明的 requires 必须 owner 显式 grant + 已连，否则隐藏。
func (b *extMCPBundle) addTool(
	ctx context.Context, cfg *marketplace.MCPServerConfig, connected DepConnected,
	session *mcpclient.Session, t *mcpclient.Tool,
) {
	if !extToolDepsAllowed(ctx, cfg, connected, t) {
		return
	}
	toolName := composeExtToolName(cfg.Name, t.Name)
	if toolName == "" {
		return
	}
	bt := capreg.NewTool(
		toolName,
		extToolDescription(cfg.Name, t),
		"calling external mcp",
		t.InputSchema,
		makeExtMCPRun(session, t.Name, nil, 0), // third-party ext tools: default budget
	)
	bt.ReadOnly = t.ReadOnly // server 声明 readOnlyHint 的工具可走 QUERY
	b.tools = append(b.tools, bt)
}

func composeExtToolName(server, tool string) string {
	return sanitizeToolName(extToolPrefix + server + "_" + tool)
}

func extToolDescription(server string, t *mcpclient.Tool) string {
	prefix := "[" + server + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// makeExtMCPRun —— CallTool 失败时不让 agent loop 整 abort —— 把 err
// 包成 errJSON 进 tool_result，AI 看到"外部工具失败"自己换路。budget 是本 tool 的调用预算
// （<=0 走默认 15s；LLM-backed 的 summarize 传 LongCallTimeout，见 F-A-6）。
func makeExtMCPRun(
	session *mcpclient.Session, realToolName string, sctx *mcpclient.SessionContext,
	budget time.Duration,
) capreg.RunFn {
	return func(ctx context.Context, args string) (string, error) {
		return extCallToToolResult(
			session.CallToolWithin(ctx, realToolName, []byte(args), sctx, budget),
		)
	}
}

// extCallToToolResult —— CallTool err 折成 errJSON tool_result，让 SDK
// continue 而非 abort (Go-side err 永远 nil 是 RunFn 契约)。
//
// 故意 nil 让 agent loop 继续而不 abort 整个 stream。
//
//nolint:nilerr // tool-result envelope: err 进 JSON text，Go err return
func extCallToToolResult(out string, err error) (string, error) {
	if err != nil {
		return errJSON("external mcp tool: " + err.Error()), nil
	}
	return out, nil
}
