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
	"strconv"
	"strings"
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

// stop —— 这次结果是否终止重试:成功 / 确定性失败 / 最后一次 / 等不起 / ctx 取消。否则
// (transient 且还有 attempt):回调 + 等,返回 false 继续。
//
// 等多久由 retryWait 决定 —— **provider 明说的 Retry-After 优先于我们自己的退避表**。
// 必须在 fireOnRetry 之前算:那一步会 drain 响应。
func (rt *retryTransport) stop(
	ctx context.Context, resp *http.Response, err error, attempt int,
) bool {
	if !transientFailure(resp, err) || attempt == rt.max {
		return true
	}
	wait := retryWait(resp, rt.baseDelay, attempt)
	if !waitFitsDeadline(ctx, wait) {
		return true // 等不到那个时刻 —— 把这次的响应交回去,别把剩下的预算睡掉
	}
	rt.fireOnRetry(ctx, resp, err, attempt, waitPlan{
		d: wait, fromHint: retryAfterDelay(resp) >= wait,
	})
	return !sleepCtx(ctx, wait) // ctx 中途取消 → 停
}

// retryWait —— 这次重试前等多久:我们自己的指数退避,和 provider 明说的间隔,取**大**的那个。
//
// 取大而不是取 Retry-After 覆盖:头缺失或读不出来时仍然有退避,而头在时我们绝不会更早重打。
// 比它要求的更早重打正是加重封禁的那个动作 —— 而在这行代码之前,那个头从来没有被读过。
func retryWait(resp *http.Response, base time.Duration, attempt int) time.Duration {
	backoff := base * time.Duration(1<<attempt)
	if hinted := retryAfterDelay(resp); hinted > backoff {
		return hinted
	}
	return backoff
}

// retryAfterDelay —— RFC 9110 的两种写法都认:整秒数,或一个 HTTP-date。真 provider 两种都发。
// 读不出来 → 0(退回自己的退避),因为一个看不懂的头不该让请求停住。
func retryAfterDelay(resp *http.Response) time.Duration {
	if resp == nil {
		return 0
	}
	v := strings.TrimSpace(resp.Header.Get("Retry-After"))
	if v == "" {
		return 0
	}
	if secs, cerr := strconv.Atoi(v); cerr == nil {
		return nonNegative(time.Duration(secs) * time.Second)
	}
	when, perr := http.ParseTime(v)
	if perr != nil {
		return 0
	}
	return nonNegative(time.Until(when))
}

// nonNegative —— 过去的时刻 / 负数秒数当作「现在就可以」,不是当作错误。
func nonNegative(d time.Duration) time.Duration {
	if d < 0 {
		return 0
	}
	return d
}

// waitFitsDeadline —— 等得起吗。等不起就**别等**:把这次的响应交回调用方(上面渲一句人话),
// 而不是把剩下的预算全部睡掉再失败 —— 那样调用方既没拿到答案,也没拿到时间。
// 没有 deadline → 等(ctx 取消仍然打断得了)。
func waitFitsDeadline(ctx context.Context, wait time.Duration) bool {
	deadline, ok := ctx.Deadline()
	if !ok {
		return true
	}
	return wait <= time.Until(deadline)
}

// fireOnRetry —— transient 失败:drain 旧响应(连接可复用)+ 调 OnRetry 钩子(attempt 从 1 数起)。
// drain 失败折进观察到的 err 一并交给钩子。
// waitPlan —— 这次重试要等多久、那个数字**从哪来**。两个字段是一件事的两半，
// 所以一起传（拆成两个参数会让 fireOnRetry 越过参数数量闸门，而闸门是对的）。
type waitPlan struct {
	d        time.Duration
	fromHint bool
}

func (rt *retryTransport) fireOnRetry(
	ctx context.Context, resp *http.Response, err error, attempt int, plan waitPlan,
) {
	status := statusOf(resp)
	if derr := drainResp(resp); derr != nil {
		err = errors.Join(err, derr)
	}
	if rt.onRetry != nil {
		rt.onRetry(ctx, RetryInfo{
			Attempt: attempt + 1, Status: status, Err: err,
			Wait: plan.d, WaitFromHint: plan.fromHint,
		})
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

// sleepCtx —— 等指定时长,可被 ctx 取消打断。返回 false = ctx 已取消。
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return true
	case <-ctx.Done():
		return false
	}
}
