// openapi_transient.go — whether a supplier call failed for now or for good.
//
// This file classifies; it does not retry. Retry has one owner — the job layer
// (internal/infra/jobs; gate: check-retry-only-in-jobs.sh). A synchronous calendar call a
// visitor waits on is sent once through the supplier egress client (httpx, NoRetry): a
// transient failure maps to ErrCalendarUnavailable ("try again later") at once.

package adapters

import (
	"errors"
	"io"
	"net"

	"github.com/atmaxmoj/standmeet/internal/infra/openapi"
)

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

// isNetworkErr — transport-layer jitter like dial/timeout/EOF.
func isNetworkErr(err error) bool {
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
