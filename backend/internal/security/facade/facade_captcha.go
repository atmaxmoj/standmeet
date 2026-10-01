package security

import (
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/security/captcha"
)

// ── captcha verification (impl: captcha subpackage) ──────────────────────

// Verifier —— captcha verifier: Verify returns nil on success (allow), error means reject.
type Verifier = captcha.Verifier

// Config —— captcha provider assembly parameters.
type Config = captcha.Config

// Provider —— captcha implementation choice (none / turnstile).
type Provider = captcha.Provider

const (
	// ProviderNone —— captcha disabled (when either SiteKey/Secret is empty).
	ProviderNone = captcha.ProviderNone
	// ProviderTurnstile —— Cloudflare Turnstile.
	ProviderTurnstile = captcha.ProviderTurnstile
)

// ErrCaptchaFailed —— sentinel for captcha verification failure.
var ErrCaptchaFailed = captcha.ErrCaptchaFailed

// NewFromConfig —— assembles a captcha Verifier per cfg (turnstile / noop). httpClient nil uses
// the default.
func NewFromConfig(cfg Config, httpClient *http.Client) Verifier {
	return captcha.NewFromConfig(cfg, httpClient)
}

// NewLive —— a verifier over the owner's current Turnstile pair, read on every check (either half
// empty → passes: the check is off).
func NewLive(pair func() CaptchaPair, httpClient *http.Client) Verifier {
	return captcha.NewLive(pair, httpClient)
}

// CaptchaPair —— a Turnstile site key and its secret.
type CaptchaPair = captcha.Pair
