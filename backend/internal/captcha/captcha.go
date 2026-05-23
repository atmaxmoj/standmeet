// Package captcha 抽象 captcha provider。当前 v1 只实现 Cloudflare
// Turnstile + noop（feature off）。
//
// 调用方式：composition root 用 NewFromConfig 装配出一个 Verifier，注入到
// LoginGuard。Verifier 接口只有一个方法 Verify(token, remoteIP)；返 nil 即
// "captcha pass"，返 error 表 "拒绝"（routes 翻译成 401 跟密码错共用同一码，
// 不告诉攻击者是 captcha 挂了还是密码错了）。
//
// SiteKey 是公开的（前端嵌进页面），Secret 是后端 verify 用的，不出 server。
package captcha

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// Provider 标识装配的 verifier 类型。
type Provider string

const (
	// ProviderNone —— captcha 关闭。NewFromConfig 在 SiteKey/Secret 任一空时返这个。
	ProviderNone Provider = "none"
	// ProviderTurnstile —— Cloudflare Turnstile。
	ProviderTurnstile Provider = "turnstile"
)

// Config 装配 Verifier 需要的所有字段。fields 顺序按 fieldalignment。
type Config struct {
	Provider Provider
	SiteKey  string
	Secret   string
}

// Verifier —— captcha 验证抽象。Verify 接收前端拿到的 challenge token +
// 客户端 IP（Cloudflare 校验 remoteip 用），返 nil 即放行；返 error 表
// 验证失败（token 过期 / 被换 / Cloudflare 服务挂了）。
type Verifier interface {
	Verify(ctx context.Context, token, remoteIP string) error
}

// ErrCaptchaFailed —— Verify 返这个表示 captcha 未通过（含 token 缺失 /
// 失效 / 服务不可用）。Handler 统一翻成 401 unauthorized，跟密码错对齐。
var ErrCaptchaFailed = errors.New("captcha verification failed")

// NewFromConfig 按 cfg 选 verifier。SiteKey 或 Secret 任一为空 → noop。
// httpClient 仅 Turnstile path 用；noop 不接触。caller 可传 nil 让默认值
// （10s timeout）兜底。
//
//nolint:ireturn // factory 按 cfg 返不同实现，接口返值是这里的意图。
func NewFromConfig(cfg Config, httpClient *http.Client) Verifier {
	if cfg.Provider == ProviderTurnstile && cfg.SiteKey != "" && cfg.Secret != "" {
		return newTurnstileVerifier(cfg.Secret, httpClient)
	}
	return noopVerifier{}
}

// FromEnvLike —— composition root 读 env 后转 Config 的 sugar。两个都非空
// 才认 turnstile；任一为空 → ProviderNone。
func FromEnvLike(siteKey, secret string) Config {
	if siteKey == "" || secret == "" {
		return Config{Provider: ProviderNone}
	}
	return Config{Provider: ProviderTurnstile, SiteKey: siteKey, Secret: secret}
}

// noopVerifier —— captcha 关闭时的实现。Verify 永远返 nil。
type noopVerifier struct{}

func (noopVerifier) Verify(_ context.Context, _, _ string) error { return nil }

// defaultHTTPTimeout —— Turnstile siteverify HTTP 默认超时；避免 Cloudflare
// 抖动时阻塞登录请求过久。
const defaultHTTPTimeout = 10 * time.Second

// defaultHTTPClient —— Turnstile siteverify 默认 client。
func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: defaultHTTPTimeout}
}
