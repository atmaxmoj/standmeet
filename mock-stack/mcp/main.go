// Package main —— minimal external MCP server fixture for e2e + 单元集成测试。
// 两种传输：默认 HTTP（e2e fixture，等价 external-mock 的角色）；带 --stdio
// 参数则走 stdio（mcpclient stdio 传输的测试替身，C2 用）。
//
// 暴露两个 tool：
//   - ping_external —— 返固定 marker（http e2e 既有用例）
//   - echo —— 回 "<marker>:<text>"（stdio list/call 验证用）
//
// 故障注入（给 error-stream 测试）：
//   - MOCK_MCP_EXIT_AFTER=N —— echo 被调 N 次后进程退出（模拟 mid-session 死）
//   - 启动时总往 stderr 写一行 banner —— 验证 stdout 帧不被 stderr 干扰
//
// 真生产 owner 注册的 MCP server 是别人写的；这里只是 fixture。
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const (
	defaultPort       = "9100"
	marker            = "[EXT-MCP-MARKER]"
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 30 * time.Second
	// mockInstructions —— server-level instructions（initialize 响应）。test
	// 断言 mcpclient.Session.Instructions() 原样浮出。
	mockInstructions = "Mock server instructions: use echo to test framing."
)

// echoCalls —— echo 被调次数；配合 MOCK_MCP_EXIT_AFTER 模拟中途退出。
var echoCalls atomic.Int64

func main() {
	// 启动 banner 走 stderr —— stdio 模式下 stdout 只能是 MCP 帧，banner 不能污染它。
	fmt.Fprintln(os.Stderr, "mcp-server-mock starting")

	// MOCK_MCP_HANG —— 进程起来但永不响应（测 client 的 initialize 超时）。
	if os.Getenv("MOCK_MCP_HANG") != "" {
		select {}
	}

	srv := server.NewMCPServer("mcp-server-mock", "0.1.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		// instructions —— MCP 原生 "how to use this server" 字段；验证 mcpclient
		// 把它当 system-prompt fragment 浮出来（外置能力携带 prompt 的载体）。
		server.WithInstructions(mockInstructions))
	// MOCK_MCP_NO_TOOLS —— 不注册任何 tool（测 "list 空 → capability 隐藏"）。
	if os.Getenv("MOCK_MCP_NO_TOOLS") == "" {
		srv.AddTool(pingTool(), pingHandler)
		srv.AddTool(echoTool(), echoHandler)
		srv.AddTool(boomTool(), boomHandler)
		srv.AddTool(returnDirectlyTool(), echoHandler)
		srv.AddTool(needsCalendarTool(), echoHandler) // _meta.requires:[calendar]（dep-grant 测试）
	}
	// 一个普通资源 —— 仅证明 resources/read 传输通（mcpclient.ReadResource 的
	// transport-boundary fixture，跟 echo/ping/boom 同级）。真正的 ui:// 卡片资源
	// 由各外置能力 server 自带，不在这个通用 mock 里预演。
	srv.AddResource(sampleResource(), sampleResourceHandler)

	if len(os.Args) > 1 && os.Args[1] == "--stdio" {
		if err := server.ServeStdio(srv); err != nil {
			log.Fatalf("serve stdio: %v", err)
		}
		return
	}
	serveHTTP(srv)
}

func serveHTTP(srv *server.MCPServer) {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	httpSrv := server.NewStreamableHTTPServer(srv, server.WithEndpointPath("/mcp"))
	mux := http.NewServeMux()
	mux.Handle("/mcp", httpSrv)
	// /mcp-auth —— 同一个 server,但**必须**带对 owner 配的认证头才让进。
	//
	// 它是一条独立路径而不是一个环境变量:mock 是所有 spec 共用的一个容器,用环境变量
	// 开全局校验会把别的 spec 一起挡在门外。走这条路的 spec 自己把 server URL 指过来。
	//
	// 有了它,"owner 填的认证头到底有没有真的发到对面"才第一次成为**可观察的**事情 ——
	// 头掉了 → 401 → 拉不到工具 → 那台 server 的工具从访客那边消失。
	mux.Handle("/mcp-auth", requireAuth(httpSrv))
	mux.HandleFunc("/healthz", healthz)
	fmt.Fprintln(os.Stderr, "mcp-server-mock listening on :"+port+"/mcp")
	httpServer := &http.Server{
		Addr: ":" + port, Handler: mux,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
	}
	if err := httpServer.ListenAndServe(); err != nil {
		log.Fatalf("listen: %v", err)
	}
}

// 走 /mcp-auth 必须带的那一对头。owner 在面板上填的就是这两个值。
const (
	authHeaderName  = "X-Mock-Auth"
	authHeaderValue = "mock-secret-token"
)

// requireAuth —— 头不对就 401,连 MCP 握手都不给。
//
// 故意在**传输层**就拒:这样"头没发出去"表现成拉不到工具,而不是某个工具调用失败 ——
// 前者是访客那边看得见的(那台 server 的工具整个消失),后者要一路点到底才发现。
func requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(authHeaderName) != authHeaderValue {
			fmt.Fprintf(os.Stderr, "mcp-server-mock: /mcp-auth rejected: %q\n",
				r.Header.Get(authHeaderName))
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func healthz(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte("ok")); err != nil {
		_ = err
	}
}

func pingTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"ping_external",
		mcpgo.WithDescription("Return a fixed marker. E2e fixture."),
	)
}

//nolint:gocritic // mcp-go 接口要求 value-typed request；改不了。
func pingHandler(
	_ context.Context, _ mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	return mcpgo.NewToolResultText(marker), nil
}

func echoTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"echo",
		mcpgo.WithDescription("Echo back the input text with a marker. Test fixture."),
		mcpgo.WithString("text", mcpgo.Required(), mcpgo.Description("text to echo")),
	)
}

// echoHandler —— 回 "<marker>:<text>"。若 MOCK_MCP_EXIT_AFTER=N，第 N 次调用后
// 进程 os.Exit(1) —— 给 mcpclient 的 "进程 mid-session 退出" 错误流测试。
//
//nolint:gocritic // mcp-go 接口要求 value-typed request；改不了。
func echoHandler(
	_ context.Context, req mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	n := echoCalls.Add(1)
	maybeExit(n)
	text, _ := req.GetArguments()["text"].(string)
	return mcpgo.NewToolResultText(marker + ":" + text), nil
}

func maybeExit(n int64) {
	limit, err := strconv.ParseInt(os.Getenv("MOCK_MCP_EXIT_AFTER"), 10, 64)
	if err == nil && limit > 0 && n >= limit {
		os.Exit(1)
	}
}

// returnDirectlyTool —— 带 `_meta.return_directly=true` + `_meta.ui_resource` 的
// tool。验证 mcpclient 把 tool `_meta` 自定义字段透传出来（外置能力声明 ReturnDirectly
// 与 per-tool ui:// 卡的载体）。复用 echoHandler 当行为；这里只关心 _meta 被搬运。
func returnDirectlyTool() mcpgo.Tool {
	t := mcpgo.NewTool(
		"clarify",
		mcpgo.WithDescription("Echo tool that declares return_directly + ui_resource via _meta. Fixture."),
		mcpgo.WithString("text", mcpgo.Required(), mcpgo.Description("text to echo")),
	)
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"return_directly": true,
		"ui_resource":     sampleResourceURI,
	})
	return t
}

const sampleResourceURI = "mock://resource/sample.txt"

// sampleResource —— 一个普通文本资源声明，仅用于验证 resources/read 传输。
func sampleResource() mcpgo.Resource {
	return mcpgo.NewResource(
		sampleResourceURI, "sample resource",
		mcpgo.WithMIMEType("text/plain"),
		mcpgo.WithResourceDescription("resources/read transport fixture."),
	)
}

// sampleResourceHandler —— 返回带 marker 的文本，让 mcpclient 测断言内容原样取回。
//
//nolint:gocritic // mcp-go 接口要求 value-typed request；改不了。
func sampleResourceHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{
			URI: sampleResourceURI, MIMEType: "text/plain", Text: marker + ":resource",
		},
	}, nil
}

func boomTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"boom",
		mcpgo.WithDescription("Always returns a tool error. Fault fixture."),
	)
}

// boomHandler —— 返 isError tool result，让 client 验证 "tool 调用中途失败 →
// 折成 errJSON tool_result（Go err nil），chat 不崩、AI 友好降级"。
//
//nolint:gocritic // mcp-go 接口要求 value-typed request；改不了。
func boomHandler(
	_ context.Context, _ mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	return mcpgo.NewToolResultError("boom: intentional failure"), nil
}
