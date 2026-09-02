// retrypolicy.go — connector outbound retry policies (decision points D-6/D-7). Built on top of
// the generic internal/retry base — the base only handles "retry with backoff, cap it, be
// interruptible", this file only "configures", never "changes". owner-notify async sends retry
// in the background on a long budget; openapi calendar sync reads/writes retry transient errors
// on a short budget (#155 unified onto StatusError.Transient).

package connector

import (
	"errors"
	"io"
	"net"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

const (
	notifyMaxAttempts = 10
	notifyBaseDelay   = 2 * time.Second
	notifyMaxInterval = 60 * time.Second
	notifyMaxTotal    = 2 * time.Minute
)

const (
	calRetryMaxAttempts = 4
	calRetryBaseDelay   = 50 * time.Millisecond
	calRetryMaxInterval = 500 * time.Millisecond
	calRetryMaxTotal    = 4 * time.Second
)

// calendarReadPolicy — retry for reads (freeBusy): retries transient errors (429/5xx's
// StatusError + network jitter), short budget. Reads are idempotent, retrying them is
// side-effect-free.
func calendarReadPolicy() retry.Policy {
	return retry.Policy{
		Retryable:   openapiTransient,
		MaxAttempts: calRetryMaxAttempts,
		BaseDelay:   calRetryBaseDelay,
		MaxInterval: calRetryMaxInterval,
		MaxTotal:    calRetryMaxTotal,
	}
}

// calendarWritePolicy — retry for writes (events.insert/delete) (D-7): only retries
// **network-layer** errors (the request may never have reached the far side, and it's safe to
// resend since the idempotency key dedupes it); 5xx is **never retried** — the server already
// received it and may have already applied it, so a fast friendly downgrade beats blindly
// resending.
func calendarWritePolicy() retry.Policy {
	return retry.Policy{
		Retryable:   openapiNetworkOnly,
		MaxAttempts: calRetryMaxAttempts,
		BaseDelay:   calRetryBaseDelay,
		MaxInterval: calRetryMaxInterval,
		MaxTotal:    calRetryMaxTotal,
	}
}

// openapiTransient — the transient-error decision: StatusError.Transient (429/5xx) or
// network-layer jitter (dial/timeout/EOF).
func openapiTransient(err error) bool {
	if err == nil {
		return false
	}
	var se *openapi.StatusError
	if errors.As(err, &se) {
		return se.Transient
	}
	return isNetworkErr(err)
}

// openapiNetworkOnly — recognizes only network-layer errors (used for write retries); any HTTP
// status error (including 5xx) → not retried.
func openapiNetworkOnly(err error) bool {
	if err == nil {
		return false
	}
	var se *openapi.StatusError
	if errors.As(err, &se) {
		return false
	}
	return isNetworkErr(err)
}

// isNetworkErr — transport-layer jitter like dial/timeout/EOF.
func isNetworkErr(err error) bool {
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}

// notifyPolicy — async sends for owner-notify (D-6 R6): background retry on a long budget,
// retries only transient transport errors (connection dropped/refused/timeout; the send never
// reached the far side, safe to resend), permanent errors (not configured, etc.) not retried.
// Used by RetryingMailProxy; confirmation emails go through a synchronous single send, never
// retried.
func notifyPolicy() retry.Policy {
	return retry.Policy{
		Retryable:   mailTransient,
		MaxAttempts: notifyMaxAttempts,
		BaseDelay:   notifyBaseDelay,
		MaxInterval: notifyMaxInterval,
		MaxTotal:    notifyMaxTotal,
	}
}
