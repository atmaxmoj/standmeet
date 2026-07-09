// Package mcpclient 是外部 MCP server 的 HTTP 客户端封装。
//
// 用 mcp-go 的 client.NewStreamableHttpClient 拨号，做三件事：
//  1. Initialize — 必须先 handshake 才能调 tools
//  2. ListTools  — 拉对方暴露的工具 specs
//  3. CallTool   — 真调一个 tool
//
// 这一层把 mcp-go 的 *mcp.Tool / *mcp.CallToolResult 翻译成本项目自己的
// 普通 string/struct，避免 inference / usecase 直接 import mcp-go (省 lint
// 跨层困扰)，跟 anthropic-sdk-go 一样收敛 vendor 边界。
package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgotransport "github.com/mark3labs/mcp-go/client/transport"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// dialTimeout —— Initialize + ListTools/ReadResource 总预算；超了视为 server 不可达。
// 20s（不是 8s）：sandbox_stdio 是冷启 —— bwrap 起命名空间 + node/python 解释器冷启 +
// MCP initialize 握手，负载高时（一次装配要起好几个沙箱）偶发 >8s，超时会把能力误判
// 成 ErrHidden（卡片/工具消失，间歇 flake）。真·死插件在 connect 阶段就快速失败，不
// 吃这个超时，所以放宽只惩罚「慢但活着」的罕见情形。
const dialTimeout = 20 * time.Second

// callTimeout —— 单次 CallTool 上限；外部 server 卡死不能拖垮 visitor chat。
const callTimeout = 15 * time.Second

// Tool —— 翻译过的 tool spec：跨包暴露用本地类型，不漏 mcp-go API。
// Meta 是 tool 的 `_meta` 透传（mcp-go 的 AdditionalFields）：mcpclient 不解释
// 它的语义，只搬运；适配器自行读取约定 key（如 return_directly）。
type Tool struct {
	Meta        map[string]any
	Name        string
	Description string
	InputSchema json.RawMessage
	// ReadOnly —— MCP `annotations.readOnlyHint`：工具是安全/幂等的读（不改状态）。
	// 供 dispatch 判定能否走 HTTP QUERY（只读工具才可 QUERY，见 routes/public/tools.go）。
	ReadOnly bool
}

// Session —— 一次外部 server 连接 + initialized handshake 完成后的状态。
// instructions 是 server 在 initialize 响应里给的 "how to use this server"
// 文本（MCP 原生字段）：mcpclient 只搬运，由适配器决定当作 system-prompt
// fragment 用。
// 字段按 govet fieldalignment 排：指针 (8B) → string header (16B) → func (8B)。
type Session struct {
	c            *mcpgoclient.Client
	closeFn      func()
	url          string
	instructions string
}

// Instructions —— server 在 initialize 响应里声明的使用说明（MCP `instructions`
// 字段）；server 未提供则为空串。
func (s *Session) Instructions() string {
	if s == nil {
		return ""
	}
	return s.instructions
}

// ErrUnreachable —— Initialize 失败（网络 / TLS / 协议）。
var ErrUnreachable = errors.New("mcp server unreachable")

// Dial 建立连接 + Initialize。headers 里可放 Authorization 等 owner 配的
// 鉴权头；nil = 无 auth。
func Dial(ctx context.Context, url string, headers map[string]string) (*Session, error) {
	opts := []mcpgotransport.StreamableHTTPCOption{}
	if len(headers) > 0 {
		opts = append(opts, mcpgotransport.WithHTTPHeaders(headers))
	}
	cli, err := mcpgoclient.NewStreamableHttpClient(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("%w: new client: %w", ErrUnreachable, err)
	}
	ictx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	res, ierr := cli.Initialize(ictx, initRequest())
	if ierr != nil {
		return nil, fmt.Errorf("%w: initialize: %w", ErrUnreachable, ierr)
	}
	return &Session{
		c: cli, url: url, instructions: initInstructions(res),
		closeFn: func() { closeQuietly(cli) },
	}, nil
}

// initInstructions —— 从 initialize 响应取 server instructions；nil-safe。
func initInstructions(res *mcpgo.InitializeResult) string {
	if res == nil {
		return ""
	}
	return res.Instructions
}

// Close —— 释放 transport。multiple Close 安全。
func (s *Session) Close() {
	if s == nil || s.closeFn == nil {
		return
	}
	s.closeFn()
	s.closeFn = nil
}

// ListTools —— 拉 server 暴露的全部 tool。
func (s *Session) ListTools(ctx context.Context) ([]Tool, error) {
	lctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	res, err := s.c.ListTools(lctx, mcpgo.ListToolsRequest{})
	if err != nil {
		return nil, fmt.Errorf("list tools (%s): %w", s.url, err)
	}
	out := make([]Tool, 0, len(res.Tools))
	for i := range res.Tools {
		out = append(out, translateTool(&res.Tools[i]))
	}
	return out, nil
}

// ReadResource —— 读一个 MCP 资源（resources/read），返回其 text 内容（多个
// TextResourceContents 拼接；blob 跳过）。MCP Apps 的 ui:// 卡片资源就经这条
// 取 HTML。uri 由 server 自定义协议（ui://...）；server 怎么解释是它的事。
func (s *Session) ReadResource(ctx context.Context, uri string) (string, error) {
	rctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	req := mcpgo.ReadResourceRequest{}
	req.Params.URI = uri
	res, err := s.c.ReadResource(rctx, req)
	if err != nil {
		return "", fmt.Errorf("read resource %s: %w", uri, err)
	}
	return extractResourceText(res), nil
}

// extractResourceText —— 拼 ReadResourceResult 里的 TextResourceContents.Text。
func extractResourceText(res *mcpgo.ReadResourceResult) string {
	var b strings.Builder
	for i := range res.Contents {
		if tc, ok := res.Contents[i].(mcpgo.TextResourceContents); ok {
			_, _ = b.WriteString(tc.Text)
		}
	}
	return b.String()
}

// SessionContext —— host 递给内建沙箱 server 的可信 session 身份，走 tool-call 的
// `_meta` 旁路（不是 LLM 控制的 arguments）。类型化（business code 禁裸 `any`）；到
// map 的转换收在本 transport 边界层。第三方插件传 nil → 不带 session 上下文。
type SessionContext struct {
	OwnerID        string
	CodeID         string
	ConversationID string
	Mode           string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
	// CorpusURIs —— the session's frozen corpus-ACL scope (role snapshot's URI
	// glob whitelist). Carried so the externalized retrieval plugin's host op can
	// re-evaluate AllowsCorpus host-side without a role lookup (the frozen scope
	// travels with the call, no staleness). Empty for non-retrieval sessions.
	CorpusURIs []string
}

func (s *SessionContext) meta() map[string]any {
	if s == nil {
		return map[string]any{}
	}
	return map[string]any{"standmeet/session": map[string]any{
		"owner_id":        s.OwnerID,
		"code_id":         s.CodeID,
		"conversation_id": s.ConversationID,
		"mode":            s.Mode,
		"visitor_name":    s.VisitorName,
		"visitor_email":   s.VisitorEmail,
		"role_id":         s.RoleID,
		"corpus_uris":     s.CorpusURIs,
	}}
}

// CallTool —— 调一个 tool。sctx 非 nil 时把可信 session 上下文挂到请求的 `_meta`，
// 内建沙箱 server 经 req.GetMeta() 读。
func (s *Session) CallTool(
	ctx context.Context, name string, args json.RawMessage, sctx *SessionContext,
) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	req, perr := buildCallToolRequest(name, args, sctx.meta())
	if perr != nil {
		return "", perr
	}
	res, err := s.c.CallTool(cctx, req)
	if err != nil {
		return "", fmt.Errorf("call tool %s: %w", name, err)
	}
	return extractText(res), nil
}

// buildCallToolRequest —— args JSON object 摊到 mcp-go 期望的
// map[string]any (mcp-go API 已经类型化好；这一步是 transport boundary
// 必须 marshal 到 any-shape)。meta 非空 → 挂 `_meta`。
func buildCallToolRequest(
	name string, args json.RawMessage, meta map[string]any,
) (mcpgo.CallToolRequest, error) {
	req := mcpgo.CallToolRequest{}
	req.Params.Name = name
	parsed, perr := parseArgsAsMap(args)
	if perr != nil {
		return mcpgo.CallToolRequest{}, fmt.Errorf("call tool %s args: %w", name, perr)
	}
	req.Params.Arguments = parsed
	if len(meta) > 0 {
		req.Params.Meta = mcpgo.NewMetaFromMap(meta)
	}
	return req, nil
}

func parseArgsAsMap(args json.RawMessage) (map[string]json.RawMessage, error) {
	if len(args) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	out := map[string]json.RawMessage{}
	if err := json.Unmarshal(args, &out); err != nil {
		return nil, fmt.Errorf("decode args: %w", err)
	}
	return out, nil
}

func translateTool(t *mcpgo.Tool) Tool {
	schemaBytes, err := json.Marshal(t.InputSchema)
	if err != nil {
		schemaBytes = []byte(`{"type":"object","properties":{}}`)
	}
	return Tool{
		Name: t.Name, Description: t.Description, InputSchema: schemaBytes,
		Meta:     toolMeta(t),
		ReadOnly: t.Annotations.ReadOnlyHint != nil && *t.Annotations.ReadOnlyHint,
	}
}

// toolMeta —— 透传 tool 的 `_meta` 自定义字段；server 没给则空 map（容器不返 nil）。
func toolMeta(t *mcpgo.Tool) map[string]any {
	if t.Meta == nil || len(t.Meta.AdditionalFields) == 0 {
		return map[string]any{}
	}
	return t.Meta.AdditionalFields
}

// extractText —— 把 CallToolResult.Content 里的 TextContent 拼起来。
// isError → 加 "[error] " 前缀让 LLM 看清。
func extractText(res *mcpgo.CallToolResult) string {
	var b strings.Builder
	if res.IsError {
		_, _ = b.WriteString("[error] ")
	}
	for i := range res.Content {
		if tc, ok := res.Content[i].(mcpgo.TextContent); ok {
			_, _ = b.WriteString(tc.Text)
		}
	}
	return b.String()
}
