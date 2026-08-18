// http_retry.go —— 给 eino chat model 注入的 HTTP client。重试机制本身已上提到
// internal/httpx(所有出站 HTTP 统一);这里只保留 inference 专属的两件事:
//   - 把 per-turn logger + 前端 retry 通知顺 ctx 传下去(transport 深在 eino model
//     call 里,拿不到 logger/sink,只能经 req.Context() 取)。
//   - OnRetry 钩子:每次退避把抖动打进日志 + emit 一帧 retrying 让前端 throbber 显。
//
// 安全边界仍由 httpx 保证:只在拿到响应头前重试(200 一返回就 stream,绝不重读已流出的
// token);绝不重试自己的 ctx 取消/超时。

package inference

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	maxLLMRetries    = 2
	llmRetryBaseWait = 400 * time.Millisecond
)

// ctxLogKey —— 把 turn 的 logger 顺 ctx 传到 transport(transport 在
// BuildChatModel 时构造,拿不到 logger;改在 RunAgentTurn 把 logger 塞 ctx,
// OnRetry 钩子用 rc.Ctx 取)。
type ctxLogKey struct{}

func withLLMLog(ctx context.Context, log *slog.Logger) context.Context {
	return context.WithValue(ctx, ctxLogKey{}, log)
}

func llmLog(ctx context.Context) *slog.Logger {
	if log, ok := ctx.Value(ctxLogKey{}).(*slog.Logger); ok && log != nil {
		return log
	}
	return slog.Default()
}

// ctxRetryKey —— 顺 ctx 把"正在重试"通知带给 sink。transport 在深层拿不到 sink;
// RunAgentTurn 塞一个回调进 ctx,OnRetry 钩子每次退避前调它 → sink emit 一帧
// retrying,前端 throbber 显 "retrying" 而非干等。没装回调(eval / 其它 caller)→ no-op。
type ctxRetryKey struct{}

func withRetryNotifier(ctx context.Context, fn func(attempt int)) context.Context {
	return context.WithValue(ctx, ctxRetryKey{}, fn)
}

func notifyRetry(ctx context.Context, attempt int) {
	if fn, ok := ctx.Value(ctxRetryKey{}).(func(int)); ok && fn != nil {
		fn(attempt)
	}
}

// retryHTTPClient —— 走 httpx 统一 client(重试 + 退避),挂 inference 的 OnRetry 钩子。
// blockInternal → 装 SSRF 守卫 dialer(untrusted BYOAI endpoint 用;拦内网 + pin 防 DNS-rebind)。
func retryHTTPClient(blockInternal bool) *http.Client {
	return httpx.NewClient(httpx.Options{
		MaxRetries:          maxLLMRetries,
		BaseDelay:           llmRetryBaseWait,
		OnRetry:             onLLMRetry,
		BlockInternalEgress: blockInternal,
	})
}

// onLLMRetry —— httpx 每次退避前回调:打 warn(让抖动在日志可见)+ 通知前端在重试。
//
// `wait_ms` + `wait_from` 是后补的（F-A-41）。原来这行只有 attempt / status，于是它
// 证得了「退避了」，证不了「**听了 provider 的**」—— 而 F-A-31 修的正是后者：
// 比对方要求的更早重打会加重封禁。少了 `wait_from`，日志上「等够了」和「碰巧等够了」
// 长得一模一样（[[nonunique-signal-not-a-receipt]]）。
//
// ⚠️ 我第一版把这条记成「重试整条路径零日志」—— 错的。日志一直在，只是我 grep 的是
// `retry` / `429` / `backoff`，而这行写的是 `llm transient failure — retrying`。
// 缺的从来不是日志，是**日志里的那两个字段**（[[read-the-failure-before-theorising]]）。
func onLLMRetry(ctx context.Context, ri httpx.RetryInfo) {
	from := "backoff"
	if ri.WaitFromHint {
		from = "retry-after"
	}
	llmLog(ctx).Warn("llm transient failure — retrying",
		"attempt", ri.Attempt, "max", maxLLMRetries, "status", ri.Status,
		"wait_ms", ri.Wait.Milliseconds(), "wait_from", from, logErrKey, ri.Err)
	notifyRetry(ctx, ri.Attempt)
}
