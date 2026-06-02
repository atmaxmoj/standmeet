// Package main —— minimal external MCP HTTP server fixture for e2e。
// 暴露一个 tool `ping_external` 返回固定 marker；让 backend 当 MCP client
// 时能验证 dial / ListTools / CallTool 全链通。
//
// 真生产 owner 注册的 MCP server 是其他人写的（Notion / Calendar / 自定义
// 微服务），这里只是 e2e fixture 等价于 job-board-mock 的角色。
package main

import (
	"context"
	"log"
	"net/http"
	"os"
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
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	srv := server.NewMCPServer("mcp-server-mock", "0.1.0",
		server.WithToolCapabilities(true))
	srv.AddTool(pingTool(), pingHandler)
	httpSrv := server.NewStreamableHTTPServer(srv, server.WithEndpointPath("/mcp"))

	mux := http.NewServeMux()
	mux.Handle("/mcp", httpSrv)
	mux.HandleFunc("/healthz", healthz)

	// port 来自 env，可能被外部控制；这里只是 stdout 不落用户面，G706 nolint。
	//nolint:gosec // log message 不进 user output；e2e fixture 启动横幅。
	log.Println("mcp-server-mock listening on :" + port + "/mcp")
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

// pingHandler —— mcp-go 强制 by-value 接收 CallToolRequest；nolint
// gocritic hugeParam，签名受 SDK 限制改不动。
//
//nolint:gocritic // mcp-go 接口要求 value-typed request；改不了。
func pingHandler(
	_ context.Context, _ mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	return mcpgo.NewToolResultText(marker), nil
}
