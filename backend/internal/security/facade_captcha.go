package security

import (
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/security/internal/captcha"
)

// ── captcha 校验(实现:internal/captcha)──────────────────────

// Verifier —— captcha 校验器:Verify 成功返 nil(放行),error 表拒绝。
type Verifier = captcha.Verifier

// Config —— captcha provider 装配参数。
type Config = captcha.Config

// Provider —— captcha 实现选择(none / turnstile)。
type Provider = captcha.Provider

const (
	// ProviderNone —— captcha 关闭(SiteKey/Secret 任一空时)。
	ProviderNone = captcha.ProviderNone
	// ProviderTurnstile —— Cloudflare Turnstile。
	ProviderTurnstile = captcha.ProviderTurnstile
)

// ErrCaptchaFailed —— captcha 校验失败 sentinel。
var ErrCaptchaFailed = captcha.ErrCaptchaFailed

// NewFromConfig —— 按 cfg 装配 captcha Verifier(turnstile / noop)。httpClient nil 用默认。
func NewFromConfig(cfg Config, httpClient *http.Client) Verifier {
	return captcha.NewFromConfig(cfg, httpClient)
}

// FromEnvLike —— (siteKey, secret) → Config;任一空 → ProviderNone。
func FromEnvLike(siteKey, secret string) Config { return captcha.FromEnvLike(siteKey, secret) }
