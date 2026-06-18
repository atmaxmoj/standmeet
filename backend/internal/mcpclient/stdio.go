// stdio.go —— C2: MCP stdio 传输（core 把插件当子进程拉起来，走 stdin/stdout）。
// 跟 Dial(http) 同一 Session/Initialize 形态，只是 transport 是 spawn 的进程。

package mcpclient

import (
	"context"
	"fmt"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// initRequest —— 共用的 MCP initialize 参数（http / stdio 同一握手）。
func initRequest() mcpgo.InitializeRequest {
	return mcpgo.InitializeRequest{
		Params: mcpgo.InitializeParams{
			ProtocolVersion: mcpgo.LATEST_PROTOCOL_VERSION,
			ClientInfo: mcpgo.Implementation{
				Name: "standmeet-backend", Version: "0.1.0",
			},
		},
	}
}

// closeQuietly —— 关 client 忽略错误（释放子进程 / transport）。
func closeQuietly(cli *mcpgoclient.Client) {
	cerr := cli.Close()
	_ = cerr
}

// DialStdio —— spawn command（带 args/env）作 MCP server 子进程，走 stdio 传输，
// Initialize 后返 Session。env 是在 os.Environ() 之上追加的额外变量（mcp-go
// 自己合并继承）。命令不存在 / initialize 超时（ctx 或 dialTimeout 先到）→ 返
// ErrUnreachable 并回收已 spawn 的子进程，不留僵尸、不永久 hang。
func DialStdio(
	ctx context.Context, command string, args []string, env map[string]string,
) (*Session, error) {
	cli, err := mcpgoclient.NewStdioMCPClient(command, envSlice(env), args...)
	if err != nil {
		return nil, fmt.Errorf("%w: stdio start %s: %w", ErrUnreachable, command, err)
	}
	ictx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	_, ierr := cli.Initialize(ictx, initRequest())
	if ierr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: stdio initialize: %w", ErrUnreachable, ierr)
	}
	return &Session{c: cli, url: "stdio:" + command, closeFn: func() { closeQuietly(cli) }}, nil
}

// envSlice —— map → []string{"K=V"}（mcp-go 在 os.Environ() 上追加这些）。
func envSlice(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}
