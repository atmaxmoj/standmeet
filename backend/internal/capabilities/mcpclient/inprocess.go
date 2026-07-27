// inprocess.go —— 连一个**同进程内**的 mcp-go server 对象。host 用它加载随产品发的
// 内建能力 server：不开网络、不起子进程、不要 goroutine —— in-memory transport，
// 纯方法调用。这是"代码解耦在外面、运行时在进程里"的加载方式：外部模块给一个
// *server.MCPServer，host 把它接上一个 in-process client。

package mcpclient

import (
	"context"
	"fmt"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgoserver "github.com/mark3labs/mcp-go/server"
)

// DialInProcess —— 连同进程内的 mcp-go server，Initialize 后返 Session。跟
// Dial(http) / DialStdio 同一 Session 形态，只是 transport 是内存直连。
func DialInProcess(ctx context.Context, srv *mcpgoserver.MCPServer) (*Session, error) {
	cli, err := mcpgoclient.NewInProcessClient(srv)
	if err != nil {
		return nil, fmt.Errorf("%w: in-process client: %w", ErrUnreachable, err)
	}
	if serr := cli.Start(ctx); serr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: in-process start: %w", ErrUnreachable, serr)
	}
	ictx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	res, ierr := cli.Initialize(ictx, initRequest())
	if ierr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("%w: in-process initialize: %w", ErrUnreachable, ierr)
	}
	return &Session{
		c: cli, url: "inproc", instructions: initInstructions(res),
		closeFn: func() { closeQuietly(cli) },
	}, nil
}
