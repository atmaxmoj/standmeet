// dial.go —— 拨到一台外部 MCP server 上。**两种 HTTP 传输,owner 不用选。**
//
// MCP 规范里 streamable HTTP(2025-03-26)取代了老的 HTTP+SSE(2024-11-05),但不少远程
// server 还挂着 `/sse` 老端点没迁。owner 手里只有一个地址,哪种传输是**对面的属性** ——
// 让他在注册表单上选一个他无从知道的东西,是把我们的问题转嫁给他。
//
// 在这之前这里只有 NewStreamableHttpClient,全仓一行 SSE 都没有:owner 粘一个老地址,
// 拨不通 → 那台 server 的工具静默消失,界面不说为什么。

package mcpclient

import (
	"context"
	"errors"
	"fmt"

	mcpgoclient "github.com/mark3labs/mcp-go/client"
	mcpgotransport "github.com/mark3labs/mcp-go/client/transport"
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// ErrUnreachable —— 拨不通(网络 / TLS / 协议 / Initialize 失败)。**两种传输都失败**才是它 ——
// 单条失败会先降级再说。调用方据此把这台 server 静默隐藏(不阻塞 chat),所以真因要包在里面。
var ErrUnreachable = errors.New("mcp server unreachable")

// Dial 建立连接 + Initialize。headers 里可放 Authorization 等 owner 配的
// 鉴权头；nil = 无 auth。
//
// **两种 HTTP 传输,owner 不用选。** MCP 规范里 streamable HTTP(2025-03-26)取代了老的
// HTTP+SSE(2024-11-05),但不少远程 server 还挂着 `/sse` 老端点。owner 手里只有一个地址,
// 哪种传输是**对面的属性** —— 让他在表单上选一个他无从知道的东西是把我们的问题转嫁给他。
//
// 先试 streamable,失败再试 SSE。**不按错误形态嗅探**:各家 server 在"不是这个协议"时回的
// 东西天差地别(404 / 405 / 406 / 空 body / 直接挂),按形态猜比多拨一次脆得多。
//
// **两次尝试共用一个 httpDialTimeout,不是各拿一个。** 第一版是各拿一个,于是一个拨不通的地址
// 要付两倍超时 —— 而这条路上挂着会话装配,访客开一场会话就得干等。e2e 当场红了:
// `/api/v1/sessions` 根本没回。降级不该由访客的等待时间来买单;共用一个截止时间之后,
// 最坏情况跟加降级之前**一样长**,而第一次快速失败(连接被拒)会把几乎整份预算留给第二次。
func Dial(ctx context.Context, url string, headers map[string]string) (*Session, error) {
	dctx, cancel := context.WithTimeout(ctx, httpDialTimeout)
	defer cancel()
	sess, err := dialStreamableHTTP(dctx, url, headers)
	if err == nil {
		return sess, nil
	}
	sseSess, sseErr := dialHTTPSSE(dctx, url, headers)
	if sseErr == nil {
		return sseSess, nil
	}
	// 两条都失败:报**两条**原因。只报一条的话,排查的人看到 SSE 的错会以为我们只会 SSE,
	// 看到 streamable 的错又不知道降级试过没有。
	return nil, fmt.Errorf("%w: streamable: %w; sse: %w", ErrUnreachable, err, sseErr)
}

func dialStreamableHTTP(
	ctx context.Context, url string, headers map[string]string,
) (*Session, error) {
	opts := []mcpgotransport.StreamableHTTPCOption{}
	if len(headers) > 0 {
		opts = append(opts, mcpgotransport.WithHTTPHeaders(headers))
	}
	cli, err := mcpgoclient.NewStreamableHttpClient(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("new client: %w", err)
	}
	return initializeOrClose(ctx, cli, url)
}

// dialHTTPSSE —— 老的 HTTP+SSE 传输。鉴权头走 SSE 自己的选项(transport.WithHeaders) ——
// streamable 那个 WithHTTPHeaders 在这条路上不适用,传丢了就是裸连。
func dialHTTPSSE(
	ctx context.Context, url string, headers map[string]string,
) (*Session, error) {
	opts := []mcpgotransport.ClientOption{}
	if len(headers) > 0 {
		opts = append(opts, mcpgotransport.WithHeaders(headers))
	}
	cli, err := mcpgoclient.NewSSEMCPClient(url, opts...)
	if err != nil {
		return nil, fmt.Errorf("new sse client: %w", err)
	}
	if serr := startSSEWithin(ctx, cli); serr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("sse start: %w", serr)
	}
	return initializeOrClose(ctx, cli, url)
}

// startSSEWithin —— 把 SSE 的事件流跑起来,**握手受拨号预算约束,流本身不受**。
//
// 这两件事不能靠一个 context 同时表达,踩过两次:
//   - 把拨号截止时间传给 Start → Dial 一返回、cancel 一执行,刚建好的流当场被掐(连上了也没用)
//   - 改成 context.WithoutCancel → 连截止时间一起剥掉了,对一个死地址 Start 一直吊着,
//     会话装配 30 秒才回来(比加降级之前更慢)
//
// 所以显式赛跑:流拿一个不会被取消的 ctx,而**等它的这一步**受 ctx 的截止时间管。
// 超时后把客户端关掉 —— 那个 goroutine 自己会结束,不留悬着的连接。
func startSSEWithin(ctx context.Context, cli *mcpgoclient.Client) error {
	done := make(chan error, 1) // 缓冲 1:超时先走了也不阻塞那个 goroutine
	go func() { done <- cli.Start(context.WithoutCancel(ctx)) }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("start: %w", err)
		}
		return nil
	case <-ctx.Done():
		return fmt.Errorf("start: %w", ctx.Err())
	}
}

// initializeOrClose —— 两条传输共用的握手收尾:Initialize 成功就包成 Session,失败**关掉客户端**
// 再返错。不关的话降级那一步会给每个连不上的地址留一个悬着的连接。
//
// 超时不在这里起 —— **截止时间由 Dial 一处设**,两次尝试共用(见 Dial 的注释)。
// 在这里各起一个的话降级会把访客的等待翻倍。
func initializeOrClose(
	ctx context.Context, cli *mcpgoclient.Client, url string,
) (*Session, error) {
	res, ierr := cli.Initialize(ctx, initRequest())
	if ierr != nil {
		closeQuietly(cli)
		return nil, fmt.Errorf("initialize: %w", ierr)
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
