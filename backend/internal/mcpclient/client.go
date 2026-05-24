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

// dialTimeout —— Initialize + ListTools 总预算；超了视为 server 不可达。
const dialTimeout = 8 * time.Second

// callTimeout —— 单次 CallTool 上限；外部 server 卡死不能拖垮 visitor chat。
const callTimeout = 15 * time.Second

// Tool —— 翻译过的 tool spec：跨包暴露用本地类型，不漏 mcp-go API。
type Tool struct {
	Name        string
	Description string
	InputSchema json.RawMessage
}

// Session —— 一次外部 server 连接 + initialized handshake 完成后的状态。
// 字段按 govet fieldalignment 排：指针 (8B) → string header (16B) → func (8B)。
type Session struct {
	c       *mcpgoclient.Client
	closeFn func()
	url     string
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
	if _, ierr := cli.Initialize(ictx, mcpgo.InitializeRequest{
		Params: mcpgo.InitializeParams{
			ProtocolVersion: mcpgo.LATEST_PROTOCOL_VERSION,
			ClientInfo: mcpgo.Implementation{
				Name: "standmeet-backend", Version: "0.1.0",
			},
		},
	}); ierr != nil {
		return nil, fmt.Errorf("%w: initialize: %w", ErrUnreachable, ierr)
	}
	return &Session{c: cli, url: url, closeFn: func() {
		if cerr := cli.Close(); cerr != nil {
			_ = cerr
		}
	}}, nil
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

// CallTool —— 调一个 tool；name+args 直接转给对方。返回 text content（多
// content 拼一起；非 text 跳）。失败返 err；isError 返 err 让 caller 翻
// tool_result。args 形态：JSON object；空串 → 空 object {}。
func (s *Session) CallTool(
	ctx context.Context, name string, args json.RawMessage,
) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	req, perr := buildCallToolRequest(name, args)
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
// 必须 marshal 到 any-shape)。
func buildCallToolRequest(name string, args json.RawMessage) (mcpgo.CallToolRequest, error) {
	req := mcpgo.CallToolRequest{}
	req.Params.Name = name
	parsed, perr := parseArgsAsMap(args)
	if perr != nil {
		return mcpgo.CallToolRequest{}, fmt.Errorf("call tool %s args: %w", name, perr)
	}
	req.Params.Arguments = parsed
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
	}
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
