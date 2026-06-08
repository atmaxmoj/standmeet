// http_retry.go —— 给 eino chat model 注入的重试 transport。第三方 LLM 偶发
// transient 失败(连接重置 / 429 / 5xx)时,在拿到响应头之前自动重试带退避,
// 让单次抖动不至于把整轮 turn 打挂。
//
// 安全边界:
//   - 只重试 transient:连接错(非 ctx 取消)/ 429 / 5xx。4xx(invalid key、
//     content policy 等)是确定性失败,不重试。
//   - 绝不重试 ctx.Canceled / DeadlineExceeded —— 那是我们自己的 per-turn 超时,
//     重试只会拖久。
//   - 只在响应头到达前重试。200 一返回就 stream,绝不会重读已经流出的 token
//     (避免重复输出)。
//
// 日志(尤其是):每次重试打 warn(attempt / status / err),让抖动在日志可见。

package inference

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

const (
	maxLLMRetries    = 2
	llmRetryBaseWait = 400 * time.Millisecond
)

// ctxLogKey —— 把 turn 的 logger 顺 ctx 传到 transport(transport 在
// BuildChatModel 时构造,拿不到 logger;改在 RunAgentTurn 把 logger 塞 ctx,
// transport 用 req.Context() 取)。
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

// ctxRetryKey —— 顺 ctx 把"正在重试"通知带给 sink。transport 在深层(eino
// model call 里)拿不到 sink;RunAgentTurn 塞一个回调进 ctx,transport 每次
// 退避前调它 → sink emit 一帧 retrying,前端 throbber 显 "retrying" 而非
// 干等。没装回调(eval / 其它 caller)时 notify 是 no-op。
type ctxRetryKey struct{}

func withRetryNotifier(ctx context.Context, fn func(attempt int)) context.Context {
	return context.WithValue(ctx, ctxRetryKey{}, fn)
}

func notifyRetry(ctx context.Context, attempt int) {
	if fn, ok := ctx.Value(ctxRetryKey{}).(func(int)); ok && fn != nil {
		fn(attempt)
	}
}

// retryHTTPClient —— 共享 client,Transport 每次请求从 req.Context() 取 logger。
func retryHTTPClient() *http.Client {
	return &http.Client{Transport: &retryTransport{base: http.DefaultTransport}}
}

type retryTransport struct {
	base http.RoundTripper
}

func (rt *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body, berr := bufferReqBody(req)
	if berr != nil {
		return nil, fmt.Errorf("buffer request body: %w", berr)
	}
	var resp *http.Response
	var err error
	for attempt := 0; attempt <= maxLLMRetries; attempt++ {
		rewindReqBody(req, body)
		resp, err = rt.base.RoundTrip(req)
		if rt.stop(req.Context(), resp, err, attempt) {
			break
		}
	}
	return resp, wrapTransport(err)
}

// stop —— 这次结果是否终止重试:成功 / 确定性失败 / 最后一次 / ctx 取消。
// 否则(transient 且还有 attempt):打日志 + 退避,返回 false 继续循环。
func (rt *retryTransport) stop(
	ctx context.Context, resp *http.Response, err error, attempt int,
) bool {
	if !transientFailure(resp, err) || attempt == maxLLMRetries {
		return true
	}
	rt.onRetry(ctx, resp, err, attempt)
	return !backoffSleep(ctx, attempt) // ctx cancelled mid-backoff → stop
}

// wrapTransport —— 包一层但用 %w 保 errors.Is(ClassifyStreamErr 还能认出
// context.DeadlineExceeded 等);nil 保持 nil。
func wrapTransport(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("llm transport: %w", err)
}

// onRetry —— transient 失败:drain 旧响应 + 打 warn(让抖动在日志可见)。
func (*retryTransport) onRetry(ctx context.Context, resp *http.Response, err error, attempt int) {
	if derr := drainResp(resp); derr != nil {
		llmLog(ctx).Debug("llm retry: draining prior response", logErrKey, derr)
	}
	llmLog(ctx).Warn("llm transient failure — retrying",
		"attempt", attempt+1, "max", maxLLMRetries, "status", statusOf(resp), logErrKey, err)
	// 通知前端这一轮在重试(attempt 从 1 数起,跟日志一致)。
	notifyRetry(ctx, attempt+1)
}

// transientFailure —— 该不该重试这次结果。
func transientFailure(resp *http.Response, err error) bool {
	if err != nil {
		// network/transport 错重试,但我们自己的 per-turn 超时/取消不重试。
		return !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded)
	}
	return resp != nil && retriableStatus(resp.StatusCode)
}

func retriableStatus(code int) bool {
	return code == http.StatusTooManyRequests || code >= http.StatusInternalServerError
}

func bufferReqBody(req *http.Request) ([]byte, error) {
	if req.Body == nil || req.Body == http.NoBody {
		return []byte{}, nil
	}
	b, err := io.ReadAll(req.Body)
	if cerr := req.Body.Close(); err == nil {
		err = cerr
	}
	return b, err
}

func rewindReqBody(req *http.Request, body []byte) {
	if len(body) > 0 {
		req.Body = io.NopCloser(bytes.NewReader(body))
	}
}

// drainResp —— 丢弃失败响应的 body(让连接可复用),返回任何 drain/close 错给
// caller 决定怎么记。
func drainResp(resp *http.Response) error {
	if resp == nil || resp.Body == nil {
		return nil
	}
	_, cpErr := io.Copy(io.Discard, resp.Body)
	if clErr := resp.Body.Close(); cpErr == nil {
		cpErr = clErr
	}
	return cpErr
}

func statusOf(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}

// backoffSleep —— 指数退避,可被 ctx 取消打断。返回 false 表示 ctx 已取消。
func backoffSleep(ctx context.Context, attempt int) bool {
	wait := llmRetryBaseWait * time.Duration(1<<attempt)
	t := time.NewTimer(wait)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
