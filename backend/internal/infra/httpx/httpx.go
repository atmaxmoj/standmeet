// Package httpx —— #132 唯一的出站 HTTP 客户端。所有子系统(jobs / marketplace /
// gotenberg / captcha / connector / inference …)经它拿 *http.Client,统一得到:
//   - 可配超时
//   - transient 失败自动重试带指数退避(连接错——非 ctx 取消/超时——以及 429 / 5xx)
//   - 可组合的 base transport(connector egress 把 SSRF 守卫 transport 传进来)
//   - 可选 OnRetry 钩子(inference 用它打日志 + 通知前端 throbber "retrying")
//
// 安全边界(沿用 inference 原有 retry transport 的判定):只在拿到响应头前重试;
// 200 一返回就交给 caller stream,绝不重读已流出的字节;绝不重试自己的 ctx 取消/超时。
// lint check-no-raw-http 保证没有别处再裸构造 http.Client。
package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

const (
	defaultMaxRetries = 2
	defaultBaseDelay  = 300 * time.Millisecond
)

// RetryInfo —— OnRetry 钩子的观察(一次退避前的状态)。ctx 单独传参,不塞进结构体。
type RetryInfo struct {
	Err     error
	Attempt int // 从 1 数起
	Status  int // 响应状态码;transport 错时为 0
	// Wait —— 这次重试**实际会等多久**。
	Wait time.Duration
	// WaitFromHint —— 那个等待**来自 provider 明说的 Retry-After**，还是我们自己的退避表。
	//
	// 为什么要分开记（F-A-41）：只记「等了 6 秒」证明得了「退避了」，证明不了「听了对方的」。
	// 而 F-A-31 修的正是后者 —— 比对方要求的更早重打会加重封禁。少了这个字段，日志上
	// 「等够了」和「碰巧等够了」长得一模一样（同 [[nonunique-signal-not-a-receipt]]）。
	WaitFromHint bool
}

// Options —— NewClient 配置。零值可用(无超时、默认重试次数/退避、DefaultTransport)。
type Options struct {
	// Base —— 底层 RoundTripper;nil → http.DefaultTransport。connector egress 传
	// 它的 SSRF 守卫 transport 进来,重试与守卫组合(每次重拨都重新过守卫)。
	Base http.RoundTripper
	// OnRetry —— 每次退避前回调(attempt 从 1 数起)。nil → 静默。inference 挂日志 + 前端通知。
	OnRetry func(context.Context, RetryInfo)
	Timeout time.Duration
	// MaxRetries —— 额外重试次数(总尝试 = MaxRetries+1)。0 → defaultMaxRetries。
	MaxRetries int
	// BaseDelay —— 首次退避,之后指数翻倍。0 → defaultBaseDelay。
	BaseDelay time.Duration
	// NoRetry —— 只发一次不重试(仍走统一 client:超时 + 可组合 base)。connector egress 用它——
	// 重试语义由 connector 层带幂等键自己管,transport 再重试会双重发。
	NoRetry bool
	// BlockInternalEgress —— install the SSRF guard dialer (block internal targets + pin) as base.
	// For an owner/user URL with NO allow-list (writings inline image). Ignored when Base is set.
	BlockInternalEgress bool
}

// NewClient —— 唯一被 lint 允许构造 http.Client 的地方。返回 retry-wrapped client。
func NewClient(o Options) *http.Client {
	return &http.Client{Timeout: o.Timeout, Transport: newRetryTransport(o)}
}

func newRetryTransport(o Options) *retryTransport {
	base := o.Base
	if base == nil {
		if o.BlockInternalEgress {
			base = internalBlockingTransport()
		} else {
			base = http.DefaultTransport
		}
	}
	return &retryTransport{
		base: base, onRetry: resolveOnRetry(o.OnRetry),
		max:       resolveMax(o),
		baseDelay: resolveDelay(o.BaseDelay),
	}
}

// resolveOnRetry —— 没人传钩子时**默认记一行日志**，而不是默默无声（F-A-41）。
//
// LLM 那条路自己挂了钩子（`inference.onLLMRetry`），这里守的是**其余所有 NewClient 调用点**：
// 连接器出站、外部 MCP、job 源抓取……它们都会重试，而一次没被记下来的退避在事后
// 只表现为「那次特别慢」。
//
// 为什么是默认而不是「让调用点记得传」：要求每个调用点记得传日志，就是又造一个需要人
// 维护的职责类（[[structure-means-no-responsibility-class]]）—— 下一个写 NewClient 的人
// 不会知道该传。所以反过来：**默认有声，要静音才显式传**。
//
// `wait_from` 是这条日志的关键字段：只记「等了多久」证明得了「退避了」，证明不了
// 「听了对方的」，而 F-A-31 修的正是后者。
func resolveOnRetry(hook func(context.Context, RetryInfo)) func(context.Context, RetryInfo) {
	if hook != nil {
		return hook
	}
	return func(ctx context.Context, in RetryInfo) {
		from := "backoff"
		if in.WaitFromHint {
			from = "retry-after"
		}
		slog.Default().WarnContext(ctx, "http retry",
			"attempt", in.Attempt, "status", in.Status,
			"wait_ms", in.Wait.Milliseconds(), "wait_from", from, "err", in.Err)
	}
}

func resolveMax(o Options) int {
	switch {
	case o.NoRetry:
		return 0 // 单次:仍走统一 client,但 transport 不重试
	case o.MaxRetries > 0:
		return o.MaxRetries
	default:
		return defaultMaxRetries
	}
}

func resolveDelay(d time.Duration) time.Duration {
	if d <= 0 {
		return defaultBaseDelay
	}
	return d
}
