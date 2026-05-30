// visitor_chat_external_mcp.go —— owner-registered 外部 MCP server 接进
// visitor chat：每个 InviteCode 选中的 server，连过去 ListTools，全部前缀
// `ext_<server>_<tool>` 加进 ToolSpec 列表；AI 调用时 backend 路由到对应
// server.CallTool。
//
// dialMCPServers 在每条消息开头并发 init 所有 server (短超时)。失败的
// server 不阻塞 chat (log + skip)，AI 只是少几个工具可用。Session 用完
// closed，每个 visitor 消息独立连接（无状态）。

package usecases

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/wangsijie/standmeet/internal/cryptobox"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/mcpclient"
)

const extToolPrefix = "ext_"

// buildExternalMCPBundle —— 通过 conv.code_id 查 mcp_servers，dial 所有
// server + ListTools。失败 server log + skip，不阻塞 chat。caller defer
// Close 释放连接。
func buildExternalMCPBundle(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) *externalMCPBundle {
	servers := loadMCPServersForConversation(ctx, deps, in)
	return dialExternalMCPs(ctx, servers)
}

func loadMCPServersForConversation(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) []domain.MCPServerConfig {
	if deps.MCPServers == nil {
		return []domain.MCPServerConfig{}
	}
	conv, cerr := deps.Conv.GetConversation(ctx, in.OwnerID, in.ConversationID)
	if cerr != nil || conv.CodeID == nil {
		return []domain.MCPServerConfig{}
	}
	servers, lerr := deps.MCPServers.ListForCode(ctx, *conv.CodeID)
	if lerr != nil {
		return []domain.MCPServerConfig{}
	}
	return servers
}

// externalMCPBundle —— 一组 owner-registered MCP server 在本次消息里的状态。
type externalMCPBundle struct {
	// 每个 tool name 映射到承载它的 server + 原始 tool name (去前缀)。
	routes map[string]extRoute
	specs  []inference.ToolSpec
	// session 用 close() 一次性清。
	sessions []*mcpclient.Session
}

type extRoute struct {
	session *mcpclient.Session
	tool    string
}

func newEmptyExternalMCPBundle() *externalMCPBundle {
	return &externalMCPBundle{routes: map[string]extRoute{}}
}

// Specs —— provider 看到的 tool 列表。可能为空。
func (b *externalMCPBundle) Specs() []inference.ToolSpec {
	if b == nil {
		return []inference.ToolSpec{}
	}
	return b.specs
}

// Has —— dispatcher 用：判断 tool name 是否归本 bundle。
func (b *externalMCPBundle) Has(name string) bool {
	if b == nil {
		return false
	}
	_, ok := b.routes[name]
	return ok
}

// Execute —— inference.ToolExecutor 实现。把 prefix-stripped 真名转给
// session.CallTool。
// Execute —— ToolExecutor 实现。CallTool 失败时不让 inference 整个 abort
// —— 把 err 包成 errJSON 文本进 tool_result，AI 看到"外部工具失败"自己换路。
//
//nolint:nilerr // tool_result 形态：err 进 text，err return 为 nil 让 SDK continue
func (b *externalMCPBundle) Execute(
	ctx context.Context, name string, input []byte,
) (string, error) {
	r, ok := b.routes[name]
	if !ok {
		return "", fmt.Errorf("unknown external mcp tool: %s", name)
	}
	out, err := r.session.CallTool(ctx, r.tool, input)
	if err != nil {
		return errJSON("external mcp tool: " + err.Error()), nil
	}
	return out, nil
}

// Close —— 释放所有 session（caller defer 调用）。
func (b *externalMCPBundle) Close() {
	if b == nil {
		return
	}
	for _, s := range b.sessions {
		s.Close()
	}
	b.sessions = nil
}

// dialExternalMCPs —— 并发 Dial 所有 server + ListTools + 拼 specs。
// 单 server 失败只 log + skip，整体不返 err。
func dialExternalMCPs(
	ctx context.Context, servers []domain.MCPServerConfig,
) *externalMCPBundle {
	bundle := newEmptyExternalMCPBundle()
	if len(servers) == 0 {
		return bundle
	}
	results := dialAllInParallel(ctx, servers)
	for i := range results {
		bundle.absorb(servers[i].Name, &results[i])
	}
	return bundle
}

// dialResult —— 字段按 govet fieldalignment 排：err interface (16B) →
// session ptr (8B) → tools slice (24B)。
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
	return dialResult{session: sess, tools: tools}
}

func buildAuthHeaders(cfg *domain.MCPServerConfig) (map[string]string, error) {
	if cfg.AuthHeaderName == "" || len(cfg.AuthHeaderValueEnc) == 0 {
		// 没配 auth → 返空 map 而非 nil，避开 nilnil。caller 接到空 map
		// 不挂 header 即可。
		return map[string]string{}, nil
	}
	plain, err := cryptobox.Decrypt(cfg.AuthHeaderValueEnc)
	if err != nil {
		return nil, fmt.Errorf("decrypt mcp auth: %w", err)
	}
	return map[string]string{cfg.AuthHeaderName: string(plain)}, nil
}

func (b *externalMCPBundle) absorb(serverName string, r *dialResult) {
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
		b.specs = append(b.specs, inference.ToolSpec{
			Name:        toolName,
			Description: extToolDescription(serverName, t),
			InputSchema: t.InputSchema,
		})
		b.routes[toolName] = extRoute{session: r.session, tool: t.Name}
	}
}

// composeExtToolName —— `ext_<server>_<tool>`，正则清非法字符同 skill。
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
