// Package httpx —— #132's single outbound HTTP client. Every subsystem (jobs / marketplace /
// gotenberg / captcha / connector / inference …) gets its *http.Client through it, which
// uniformly provides:
//   - a configurable timeout
//   - automatic retry with exponential backoff on transient failures (connection errors —
//     not ctx cancel/timeout — plus 429 / 5xx)
//   - a composable base transport (connector egress passes in its SSRF guard transport)
//   - an optional OnRetry hook (inference uses it to log + tell the frontend to show a
//     "retrying" throbber)
//
// Safety boundary (carried over from inference's original retry transport logic): only retry
// before response headers arrive; once a 200 comes back it goes straight to the caller's
// stream — bytes already streamed out are never re-read; our own ctx cancel/timeout is never
// retried.
// The lint rule check-no-raw-http guarantees no other call site builds an http.Client by hand.
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

// RetryInfo —— what the OnRetry hook observes (state right before one backoff wait). ctx is
// passed separately, not stuffed into the struct.
type RetryInfo struct {
	Err     error
	Attempt int // counting from 1
	Status  int // response status code; 0 on a transport error
	// Wait —— how long this retry **will actually wait**.
	Wait time.Duration
	// WaitFromHint —— whether that wait **came from the provider's explicit Retry-After**,
	// or from our own backoff table.
	//
	// Why log this separately (F-A-41): logging just "waited 6s" proves we backed off, not
	// that we listened to the provider. F-A-31 fixes exactly the latter — retrying earlier
	// than the provider asked makes a ban worse. Without this field, "waited enough" and
	// "happened to wait enough" look identical in the logs (same trap as
	// [[nonunique-signal-not-a-receipt]]).
	WaitFromHint bool
}

// Options —— NewClient config. The zero value works (no timeout, default retry count/backoff,
// DefaultTransport).
type Options struct {
	// Base —— the underlying RoundTripper; nil → http.DefaultTransport. connector egress
	// passes in its SSRF guard transport here, composing retry with the guard (every redial
	// goes through the guard again).
	Base http.RoundTripper
	// OnRetry —— called before each backoff (attempt counts from 1). nil → silent.
	// inference hooks it up to logging + a frontend notification.
	OnRetry func(context.Context, RetryInfo)
	Timeout time.Duration
	// MaxRetries —— extra retry count (total attempts = MaxRetries+1). 0 → defaultMaxRetries.
	MaxRetries int
	// BaseDelay —— first backoff, doubling exponentially after. 0 → defaultBaseDelay.
	BaseDelay time.Duration
	// NoRetry —— send exactly once, no retry (still goes through the unified client: timeout
	// + composable base). connector egress uses this — retry semantics there are owned by the
	// connector layer via an idempotency key; retrying again at the transport level would
	// double-send.
	NoRetry bool
	// BlockInternalEgress —— install the SSRF guard dialer (block internal targets + pin) as base.
	// For an owner/user URL with NO allow-list (writings inline image). Ignored when Base is set.
	BlockInternalEgress bool
}

// NewClient —— the only place lint allows an http.Client to be constructed. Returns a
// retry-wrapped client.
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

// resolveOnRetry —— when no one passes a hook, **default to logging one line**, instead of
// staying silent (F-A-41).
//
// The LLM path already hooks its own (`inference.onLLMRetry`); what this guards is **every
// other NewClient call site**: connector egress, external MCP, job source fetches … they all
// retry too, and a backoff that never got logged just looks like "that one call was slow" in
// hindsight.
//
// Why default rather than "every call site remembers to pass one": requiring each call site
// to remember to pass logging is just another responsibility class that needs a human to
// maintain it ([[structure-means-no-responsibility-class]]) — the next person who writes a
// NewClient call won't know they're supposed to. So invert it instead: **loud by default,
// silence only if explicitly opted into**.
//
// `wait_from` is the key field in this log line: logging just "waited how long" proves we
// backed off, not that we listened to the provider — and F-A-31 fixes exactly the latter.
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
		return 0 // single shot: still goes through the unified client, but transport won't retry
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
