// retry_transport.go —— httpx 的 retry RoundTripper。机制沿用 inference 原有实现:
// 缓冲请求体以便重发、指数退避(可被 ctx 打断)、只重试 transient、绝不重试 ctx 取消/超时。

package httpx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type retryTransport struct {
	base      http.RoundTripper
	onRetry   func(context.Context, RetryInfo)
	max       int
	baseDelay time.Duration
}

func (rt *retryTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	body, berr := bufferReqBody(req)
	if berr != nil {
		return nil, fmt.Errorf("httpx: buffer request body: %w", berr)
	}
	var resp *http.Response
	var err error
	for attempt := 0; attempt <= rt.max; attempt++ {
		rewindReqBody(req, body)
		resp, err = rt.base.RoundTrip(req)
		if rt.stop(req.Context(), resp, err, attempt) {
			break
		}
	}
	if err != nil {
		return resp, fmt.Errorf("httpx roundtrip: %w", err)
	}
	return resp, nil
}

// stop —— 这次结果是否终止重试:成功 / 确定性失败 / 最后一次 / ctx 取消。否则
// (transient 且还有 attempt):回调 + 退避,返回 false 继续。
func (rt *retryTransport) stop(
	ctx context.Context, resp *http.Response, err error, attempt int,
) bool {
	if !transientFailure(resp, err) || attempt == rt.max {
		return true
	}
	rt.fireOnRetry(ctx, resp, err, attempt)
	return !backoffSleep(ctx, rt.baseDelay, attempt) // ctx 中途取消 → 停
}

// fireOnRetry —— transient 失败:drain 旧响应(连接可复用)+ 调 OnRetry 钩子(attempt 从 1 数起)。
// drain 失败折进观察到的 err 一并交给钩子。
func (rt *retryTransport) fireOnRetry(
	ctx context.Context, resp *http.Response, err error, attempt int,
) {
	if derr := drainResp(resp); derr != nil {
		err = errors.Join(err, derr)
	}
	if rt.onRetry != nil {
		rt.onRetry(ctx, RetryInfo{Attempt: attempt + 1, Status: statusOf(resp), Err: err})
	}
}

// transientFailure —— 该不该重试。network/transport 错重试,但 ctx 取消/超时不重试
// (那是 caller 自己的截止,重试只拖久);响应则看 429 / 5xx。
func transientFailure(resp *http.Response, err error) bool {
	if err != nil {
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

// drainResp —— 丢弃失败响应 body 让连接可复用。返回 drain/close 错交调用方决定怎么记。
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

// backoffSleep —— 指数退避,可被 ctx 取消打断。返回 false = ctx 已取消。
func backoffSleep(ctx context.Context, base time.Duration, attempt int) bool {
	t := time.NewTimer(base * time.Duration(1<<attempt))
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
