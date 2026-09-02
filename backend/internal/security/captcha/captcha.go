// Package captcha — internal captcha implementation for the security domain.
// v1 only implements Cloudflare Turnstile + a noop (feature off). External
// callers only go through the security facade.
//
// Wiring: the composition root uses NewFromConfig to assemble a Verifier and
// injects it into LoginGuard. The Verifier interface has one method,
// Verify(token, remoteIP); nil means "captcha pass", error means "reject"
// (routes translate this into the same 401 the wrong-password case uses, so
// an attacker can't tell whether captcha failed or the password was wrong).
//
// SiteKey is public (embedded in the frontend page); Secret is used by the
// backend for verify and never leaves the server.
package captcha

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

// Provider identifies which verifier type gets assembled.
type Provider string

const (
	// ProviderNone — captcha is off. NewFromConfig returns this whenever
	// SiteKey or Secret is empty.
	ProviderNone Provider = "none"
	// ProviderTurnstile — Cloudflare Turnstile.
	ProviderTurnstile Provider = "turnstile"
)

// Config carries every field NewFromConfig needs to assemble a Verifier.
// Field order follows fieldalignment.
type Config struct {
	Provider Provider
	SiteKey  string
	Secret   string
}

// Verifier — captcha verification abstraction. Verify takes the challenge
// token obtained by the frontend plus the client IP (used by Cloudflare's
// remoteip check); nil means it passed, error means verification failed
// (token expired / swapped / Cloudflare's service is down).
type Verifier interface {
	Verify(ctx context.Context, token, remoteIP string) error
}

// ErrCaptchaFailed — Verify returns this to mean captcha did not pass
// (covers missing token / expired token / service unavailable). The handler
// uniformly translates it to 401 unauthorized, aligned with the wrong-
// password case.
var ErrCaptchaFailed = errors.New("captcha verification failed")

// NewFromConfig picks a verifier based on cfg. If either SiteKey or Secret
// is empty → noop. httpClient is only used on the Turnstile path; noop
// never touches it. Caller may pass nil to fall back to the default
// (10s timeout).
//
// return is intentional here.
//
//nolint:ireturn // factory returns different impls per cfg — the interface
func NewFromConfig(cfg Config, httpClient *http.Client) Verifier {
	if cfg.Provider == ProviderTurnstile && cfg.SiteKey != "" && cfg.Secret != "" {
		return newTurnstileVerifier(cfg.Secret, httpClient)
	}
	return noopVerifier{}
}

// FromEnvLike — sugar for the composition root to turn env vars into a
// Config. Only recognizes turnstile when both are non-empty; either one
// empty → ProviderNone.
func FromEnvLike(siteKey, secret string) Config {
	if siteKey == "" || secret == "" {
		return Config{Provider: ProviderNone}
	}
	return Config{Provider: ProviderTurnstile, SiteKey: siteKey, Secret: secret}
}

// noopVerifier — implementation used when captcha is off. Verify always
// returns nil.
type noopVerifier struct{}

func (noopVerifier) Verify(_ context.Context, _, _ string) error { return nil }

// defaultHTTPTimeout — default HTTP timeout for the Turnstile siteverify
// call; keeps Cloudflare jitter from blocking a login request too long.
const defaultHTTPTimeout = 10 * time.Second

// defaultHTTPClient — default client for the Turnstile siteverify call.
func defaultHTTPClient() *http.Client {
	return httpx.NewClient(httpx.Options{Timeout: defaultHTTPTimeout})
}
