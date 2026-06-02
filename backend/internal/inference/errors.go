// errors.go —— inference sentinel errors + status classification.
// Upstream HTTP statuses + transport failures normalize to one of the
// sentinels below so route layer never sees raw 4xx/5xx and the
// apierr.Case → envelope table stays stable.

package inference

import (
	"errors"
	"net/http"
)

// Sentinel errors.
var (
	ErrRateLimited     = errors.New("inference: rate limited")
	ErrContextTooLong  = errors.New("inference: context length exceeded")
	ErrInvalidAPIKey   = errors.New("inference: invalid api key")
	ErrPaymentRequired = errors.New("inference: payment required / quota exhausted")
	ErrContentPolicy   = errors.New("inference: content policy violation")
	ErrModelNotFound   = errors.New("inference: model not found")
	ErrOverloaded      = errors.New("inference: provider overloaded")
	ErrServerSide      = errors.New("inference: provider 5xx")
	ErrTimeout         = errors.New("inference: timeout")
	ErrNetwork         = errors.New("inference: network failure")
	// ErrOwnerProviderUnconfigured —— owner row's ai_provider_key_enc
	// still empty; visitor chat must show a friendly fallback.
	ErrOwnerProviderUnconfigured = errors.New("owner AI provider not configured")
	// ErrUnsupportedProvider —— v1 only supports anthropic-compatible
	// upstreams. owner picking deepseek/openai/etc surfaces this.
	ErrUnsupportedProvider = errors.New(
		"inference: only anthropic-compatible providers supported in v1")
)

// StreamErrClass —— HTTP status + machine code carrier so classifier
// helpers stay within the 2-return revive cap. fieldalignment: string
// first (pointer-sized) then int.
type StreamErrClass struct {
	Code   string
	Status int
}

// ClassifyStreamErr —— upstream sentinel → HTTP status + machine code.
// Route layer surfaces this on pre-stream failures (auth, cred resolve,
// upstream open) before any SSE byte has flowed.
func ClassifyStreamErr(err error) StreamErrClass {
	if c, ok := classifyDirectStatus(err); ok {
		return c
	}
	if c, ok := classifyServiceStatus(err); ok {
		return c
	}
	return StreamErrClass{Code: "internal", Status: http.StatusInternalServerError}
}

func classifyDirectStatus(err error) (StreamErrClass, bool) {
	switch {
	case errors.Is(err, ErrInvalidAPIKey):
		return StreamErrClass{Code: "invalid_api_key", Status: http.StatusUnauthorized}, true
	case errors.Is(err, ErrUnsupportedProvider):
		return StreamErrClass{Code: "unsupported_provider", Status: http.StatusBadRequest}, true
	case errors.Is(err, ErrRateLimited):
		return StreamErrClass{Code: "rate_limited", Status: http.StatusTooManyRequests}, true
	case errors.Is(err, ErrTimeout):
		return StreamErrClass{Code: "timeout", Status: http.StatusGatewayTimeout}, true
	}
	return StreamErrClass{}, false
}

func classifyServiceStatus(err error) (StreamErrClass, bool) {
	const svc = http.StatusServiceUnavailable
	switch {
	case errors.Is(err, ErrOwnerProviderUnconfigured):
		return StreamErrClass{Code: "owner_unconfigured", Status: svc}, true
	case errors.Is(err, ErrOverloaded):
		return StreamErrClass{Code: "overloaded", Status: svc}, true
	case errors.Is(err, ErrNetwork):
		return StreamErrClass{Code: "network", Status: svc}, true
	}
	return StreamErrClass{}, false
}
