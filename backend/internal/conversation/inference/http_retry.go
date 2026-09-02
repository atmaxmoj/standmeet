// http_retry.go —— the HTTP client injected into the eino chat model. The retry mechanism
// itself has already been lifted up into internal/httpx (unified across all outbound HTTP);
// this file only keeps the two things specific to inference:
//   - carrying the per-turn logger + the frontend retry notification down through ctx (the
//     transport is buried deep inside an eino model call, with no way to get at the
//     logger/sink except via req.Context()).
//   - the OnRetry hook: on every backoff, logs the jitter + emits one retrying frame for the
//     frontend throbber to show.
//
// The safety boundary is still guaranteed by httpx: retries only happen before response
// headers arrive (once a 200 comes back it starts streaming, and already-streamed tokens are
// never re-read); it never retries its own ctx cancellation/timeout.

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

// ctxLogKey —— carries the turn's logger down to the transport via ctx (the transport is
// constructed at BuildChatModel time, with no access to the logger; instead RunAgentTurn
// stuffs the logger into ctx, and the OnRetry hook fetches it via rc.Ctx).
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

// ctxRetryKey —— carries a "currently retrying" notification to the sink via ctx. The
// transport, buried deep, has no access to the sink; RunAgentTurn stuffs a callback into ctx,
// and the OnRetry hook calls it before every backoff → the sink emits one retrying frame, and
// the frontend throbber shows "retrying" instead of sitting idle. No callback wired in (eval /
// other callers) → no-op.
type ctxRetryKey struct{}

func withRetryNotifier(ctx context.Context, fn func(attempt int)) context.Context {
	return context.WithValue(ctx, ctxRetryKey{}, fn)
}

func notifyRetry(ctx context.Context, attempt int) {
	if fn, ok := ctx.Value(ctxRetryKey{}).(func(int)); ok && fn != nil {
		fn(attempt)
	}
}

// retryHTTPClient —— goes through httpx's unified client (retry + backoff), with inference's
// own OnRetry hook attached. blockInternal → wires in an SSRF-guarding dialer (used for
// untrusted BYOAI endpoints; blocks internal networks + pins against DNS-rebind).
func retryHTTPClient(blockInternal bool) *http.Client {
	return httpx.NewClient(httpx.Options{
		MaxRetries:          maxLLMRetries,
		BaseDelay:           llmRetryBaseWait,
		OnRetry:             onLLMRetry,
		BlockInternalEgress: blockInternal,
	})
}

// onLLMRetry —— httpx's callback before every backoff: logs a warn (making the jitter visible
// in the logs) + notifies the frontend it's retrying.
//
// `wait_ms` + `wait_from` were added later (F-A-41). This line used to carry only attempt /
// status, which could prove "a backoff happened" but not "**it actually respected the
// provider**" — and it's the latter that F-A-31 fixed: firing again sooner than the provider
// asked for makes a ban worse. Without `wait_from`, "waited long enough" and "happened to wait
// long enough" look identical in the logs ([[nonunique-signal-not-a-receipt]]).
//
// Note: my first pass logged this finding as "zero logging on the whole retry path" — wrong.
// The logging was there the whole time, I was just grepping for `retry` / `429` / `backoff`,
// while this line actually reads `llm transient failure — retrying`. What was missing was never
// the log line, it was **those two fields inside it**
// ([[read-the-failure-before-theorising]]).
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
