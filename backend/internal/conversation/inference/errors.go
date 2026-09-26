// errors.go —— inference sentinel errors + status classification.
// Upstream HTTP statuses + transport failures normalize to one of the
// sentinels below so route layer never sees raw 4xx/5xx and the
// apierr.Case → envelope table stays stable.

package inference

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	einoopenai "github.com/cloudwego/eino-ext/components/model/openai"
	openai "github.com/meguminnnnnnnnn/go-openai"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
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
		"inference: only anthropic-compatible providers supported in v1",
	)
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
	if errors.Is(err, httpx.ErrBlockedEgress) {
		return StreamErrClass{Code: "endpoint_blocked", Status: http.StatusBadRequest}
	}
	if c, ok := classifyDirectStatus(err); ok {
		return c
	}
	if c, ok := classifyServiceStatus(err); ok {
		return c
	}
	return StreamErrClass{Code: "internal", Status: http.StatusInternalServerError}
}

// upstreamStatus —— the HTTP status the AI provider answered with, when the error carries one.
// The provider SDKs (eino's openai and claude models) return their own error types; nothing
// mapped them onto the sentinels above, so a provider 429 / 401 / 529 fell through to "internal"
// and the visitor read "Something went wrong on my end" — our fault, when it was the provider's
// answer. This is the one place those types are read.
//
// The openai model does NOT pass go-openai's *APIError up: it converts it into its own
// eino-ext *APIError (components/model/openai convOrigAPIError), a new value with no Unwrap. So
// that is the type read here; go-openai's *RequestError is not converted and reaches us as is.
func upstreamStatus(err error) int {
	var oaiAPI *einoopenai.APIError
	if errors.As(err, &oaiAPI) {
		return oaiAPI.HTTPStatusCode
	}
	var oaiReq *openai.RequestError
	if errors.As(err, &oaiReq) {
		return oaiReq.HTTPStatusCode
	}
	var claude *anthropic.Error
	if errors.As(err, &claude) {
		return claude.StatusCode
	}
	return 0
}

// errChain —— the concrete type at each unwrap level, with its full package path. Classification
// reads types, not text: when an error is misclassified, the message alone cannot say which layer
// broke the chain, and this line can. The package path matters: %T alone printed
// "*openai.APIError" for eino-ext's type, which is not go-openai's — two packages named openai.
func errChain(err error) string {
	var parts []string
	for e := err; e != nil; e = errors.Unwrap(e) {
		t := reflect.TypeOf(e)
		pkg := t.PkgPath()
		if t.Kind() == reflect.Pointer {
			pkg = t.Elem().PkgPath()
		}
		parts = append(parts, fmt.Sprintf("%s (%s)", t, pkg))
	}
	return strings.Join(parts, " > ")
}

// upstreamSentinels —— provider status → the sentinel that already carries its meaning.
var upstreamSentinels = map[int]error{
	http.StatusTooManyRequests:    ErrRateLimited,
	http.StatusUnauthorized:       ErrInvalidAPIKey,
	http.StatusForbidden:          ErrInvalidAPIKey,
	http.StatusServiceUnavailable: ErrOverloaded,
	529:                           ErrOverloaded, // Anthropic's "overloaded"
}

// normalizeUpstream —— err, joined with the sentinel its provider status means (if any), so every
// errors.Is check below sees the provider's answer.
func normalizeUpstream(err error) error {
	if s, ok := upstreamSentinels[upstreamStatus(err)]; ok {
		return errors.Join(err, s)
	}
	return err
}

// IsRateLimited —— the provider said "not this fast": its own 429 after our retries, or a
// retry-after longer than this turn is willing to wait.
func IsRateLimited(err error) bool {
	err = normalizeUpstream(err)
	return errors.Is(err, ErrRateLimited) || errors.Is(err, httpx.ErrRetryTooLong)
}

func classifyDirectStatus(err error) (StreamErrClass, bool) {
	err = normalizeUpstream(err)
	switch {
	case errors.Is(err, ErrInvalidAPIKey):
		return StreamErrClass{Code: "invalid_api_key", Status: http.StatusUnauthorized}, true
	case errors.Is(err, ErrUnsupportedProvider):
		return StreamErrClass{Code: "unsupported_provider", Status: http.StatusBadRequest}, true
	case IsRateLimited(err):
		return StreamErrClass{Code: "rate_limited", Status: http.StatusTooManyRequests}, true
	case errors.Is(err, ErrTimeout), errors.Is(err, context.DeadlineExceeded):
		return StreamErrClass{Code: "timeout", Status: http.StatusGatewayTimeout}, true
	}
	return StreamErrClass{}, false
}

// friendlyMessages —— code → user-facing copy. Never leaks a raw error / NodeRunError / stack
// trace to the UI (CLAUDE.md: errors must be user-friendly).
var friendlyMessages = map[string]string{
	"timeout":              "That took too long — try a shorter, more specific question.",
	"rate_limited":         "The AI is busy right now — give it a minute and ask again.",
	"overloaded":           "The AI provider is overloaded — please try again shortly.",
	"invalid_api_key":      "The AI provider key isn't working — the owner needs to fix it.",
	"owner_unconfigured":   "This page doesn't have an AI provider set up yet.",
	"unsupported_provider": "That AI provider isn't supported here.",
	"network":              "Network problem reaching the AI provider. Please try again.",
	"endpoint_blocked": "That AI endpoint resolves to an internal/private address and " +
		"isn't allowed.",
}

// FriendlyMessage —— falls back to a neutral message for an unknown code.
func FriendlyMessage(code string) string {
	if m, ok := friendlyMessages[code]; ok {
		return m
	}
	return "Something went wrong on my end — please try again."
}

func classifyServiceStatus(err error) (StreamErrClass, bool) {
	const svc = http.StatusServiceUnavailable
	err = normalizeUpstream(err)
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
