package httpx

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// ErrRetryTooLong —— the provider asked us to retry later than this caller is willing to wait.
// The transport gives up at once instead of sleeping: a visitor on a free, rate-limited provider
// (Groq free tier: `retry-after` 31–43s per step, prod 2026-09-25) sat in silence for minutes;
// they'd rather be told now.
var ErrRetryTooLong = errors.New("httpx: provider asked to retry later than the caller waits")

type ctxMaxWaitKey struct{}

// WithMaxRetryWait —— cap how long a retry on this ctx may wait. A transient failure whose wait
// (the provider's Retry-After, or our backoff) exceeds it fails fast with ErrRetryTooLong.
func WithMaxRetryWait(ctx context.Context, d time.Duration) context.Context {
	return context.WithValue(ctx, ctxMaxWaitKey{}, d)
}

// waitOverBudget —— is this a transient failure whose wait exceeds the ctx's cap? No cap → never.
func waitOverBudget(ctx context.Context, resp *http.Response, err error, wait time.Duration) bool {
	budget, ok := ctx.Value(ctxMaxWaitKey{}).(time.Duration)
	return ok && transientFailure(resp, err) && wait > budget
}

// giveUpTooLong —— drop the rate-limited response (so the connection is reusable) and say why.
func giveUpTooLong(resp *http.Response) (*http.Response, error) {
	if derr := drainResp(resp); derr != nil {
		return nil, errors.Join(ErrRetryTooLong, derr)
	}
	return nil, ErrRetryTooLong
}
