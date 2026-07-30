// stdio.go —— C2: MCP stdio 传输（core 把插件当子进程拉起来，走 stdin/stdout）。
// 跟 Dial(http) 同一 Session/Initialize 形态，只是 transport 是 spawn 的进程。

package mcpclient

import (
	"context"
	"errors"
	"fmt"
	"time"

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

// dialTiming —— 拨号失败时把「花了多久」和「是谁取消的」写进错误串。
//
// 为什么需要:失败日志只说 `stdio initialize: transport error: context canceled`,
// 而 `context canceled`(父 ctx 被取消) 跟 `deadline exceeded`(撞我们自己的 dialTimeout)
// 是完全不同的病 —— 前者是**调用方先放弃**(HTTP 请求断了),后者是插件真的起不来。
// 光看这一行分不出冷启动到底花了多久、也分不出该调大预算还是该加速 spawn。
// 一并带上父 ctx 的状态,让根因从日志里可读,不必靠推测。
func dialTiming(parent context.Context, spawnMS int64, initStart time.Time) string {
	cause := "parent-live"
	switch {
	case errors.Is(parent.Err(), context.Canceled):
		cause = "parent-canceled(caller gave up first)"
	case errors.Is(parent.Err(), context.DeadlineExceeded):
		cause = "parent-deadline"
	default: // parent still live: the failure is the plugin's own, not a caller giving up
	}
	return fmt.Sprintf("[spawn=%dms init=%dms budget=%s %s]",
		spawnMS, time.Since(initStart).Milliseconds(), dialTimeout, cause)
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
	spawnStart := time.Now()
	cli, err := mcpgoclient.NewStdioMCPClient(command, envSlice(env), args...)
	if err != nil {
		return nil, fmt.Errorf("%w: stdio start %s: %w", ErrUnreachable, command, err)
	}
	spawnMS := time.Since(spawnStart).Milliseconds()
	ictx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	initStart := time.Now()
	res, ierr := cli.Initialize(ictx, initRequest())
	if ierr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: stdio initialize %s: %w",
			ErrUnreachable, dialTiming(ctx, spawnMS, initStart), ierr)
	}
	return &Session{
		c: cli, url: "stdio:" + command, instructions: initInstructions(res),
		closeFn: func() { closeQuietly(cli) },
	}, nil
}

// envSlice —— map → []string{"K=V"}（mcp-go 在 os.Environ() 上追加这些）。
func envSlice(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}
