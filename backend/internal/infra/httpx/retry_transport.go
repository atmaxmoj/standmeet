// retry_transport.go —— httpx's retry RoundTripper. The mechanism carries over inference's
// original implementation: buffer the request body for re-send, exponential backoff
// (interruptible by ctx), only retry transient failures, never retry ctx cancel/timeout.

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

// stop —— whether this result ends the retry loop: success / deterministic failure / last
// attempt / can't afford the wait / ctx canceled. Otherwise (transient and attempts remain):
// fire the callback + wait, return false to continue.
//
// How long to wait is decided by retryWait — **the provider's explicit Retry-After takes
// priority over our own backoff table**. Must be computed before fireOnRetry: that step
// drains the response.
func (rt *retryTransport) stop(
	ctx context.Context, resp *http.Response, err error, attempt int,
) bool {
	if !transientFailure(resp, err) || attempt == rt.max {
		return true
	}
	wait := retryWait(resp, rt.baseDelay, attempt)
	if !waitFitsDeadline(ctx, wait) {
		// can't reach that moment — hand this response back, don't sleep away the budget.
		return true
	}
	rt.fireOnRetry(ctx, resp, err, attempt, waitPlan{
		d: wait, fromHint: retryAfterDelay(resp) >= wait,
	})
	return !sleepCtx(ctx, wait) // ctx canceled mid-wait → stop
}

// retryWait —— how long to wait before this retry: take the **larger** of our own exponential
// backoff and the interval the provider explicitly asked for.
//
// Max rather than letting Retry-After override outright: a missing or unreadable header still
// gets a backoff, and when the header is present we never retry earlier than it says.
// Retrying earlier than asked is exactly the action that makes a ban worse — and before this
// line of code, that header had never once been read.
func retryWait(resp *http.Response, base time.Duration, attempt int) time.Duration {
	backoff := base * time.Duration(1<<attempt)
	if hinted := retryAfterDelay(resp); hinted > backoff {
		return hinted
	}
	return backoff
}

// retryAfterDelay —— accepts both RFC 9110 forms: a whole number of seconds, or an HTTP-date.
// Real providers send both. Unparseable → 0 (falls back to our own backoff), because a header
// we can't understand shouldn't stall the request.
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

// nonNegative —— treat a past timestamp / negative seconds as "fine to go now", not an error.
func nonNegative(d time.Duration) time.Duration {
	if d < 0 {
		return 0
	}
	return d
}

// waitFitsDeadline —— can we afford the wait? If not, **don't wait**: hand this response back
// to the caller (so a layer above can render a human sentence), instead of sleeping away the
// whole remaining budget only to fail anyway — that way the caller gets neither an answer nor
// the time back.
// No deadline → wait (ctx cancel can still interrupt it).
func waitFitsDeadline(ctx context.Context, wait time.Duration) bool {
	deadline, ok := ctx.Deadline()
	if !ok {
		return true
	}
	return wait <= time.Until(deadline)
}

// fireOnRetry —— on a transient failure: drain the old response (so the connection can be
// reused) + call the OnRetry hook (attempt counts from 1).
// A drain failure is folded into the observed err and passed to the hook together.
// waitPlan —— how long this retry waits, and **where that number came from**. The two fields
// are two halves of one fact, so they travel together (splitting them into two parameters
// would push fireOnRetry over the argument-count gate, and that gate is right to stop it).
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

// transientFailure —— should this be retried. Retry on network/transport errors, but not on
// ctx cancel/timeout (that's the caller's own deadline; retrying only drags it out longer);
// for a response, check 429 / 5xx.
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

// drainResp —— discard a failed response's body so the connection can be reused. Returns any
// drain/close error for the caller to decide how to log.
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

// sleepCtx —— wait the given duration, interruptible by ctx cancel. Returns false = ctx was
// canceled.
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
