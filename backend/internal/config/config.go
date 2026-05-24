// Package config 从环境变量读 server 配置。
//
// 设计上故意简单：一次读完、不刷新。Owner 不该在运行时改 DB 连接串。
// 缺失关键 env（DATABASE_URL / REDIS_URL）直接 fail-fast，不给 default
// 因为本地 dev 也通过 docker-compose 注入。
package config

import (
	"errors"
	"os"
	"strconv"
)

// Config 持有进程启动时一次性读完的运行时配置。
//
// 故意没有 PublicURL/PUBLIC_URL：删 env-as-config 的"对外 URL"指针。每条
// owner 的 public_url 在 claim 表单里填、写进 owners 行；SEO / QR 全
// 从 DB 读，无 env、无 default、无 fallback。
type Config struct {
	Host            string
	Port            string
	DatabaseURL     string
	RedisURL        string
	SessionKey      string
	CustomPagesRoot string // builder 写、backend 读 custom page build artifact 的根
	// JobFetch*BaseURL —— 各 job-board adapter 的 base URL 覆写。production
	// 留空走真 URL；e2e/dev 指 docker-compose 起的 job-board-mock。见
	// docs/design/job-loop-tests.md T.2。
	JobFetchGreenhouseBaseURL      string
	JobFetchLeverBaseURL           string
	JobFetchAshbyBaseURL           string
	JobFetchRemoteOKBaseURL        string
	JobFetchWWRBaseURL             string
	JobFetchHNBaseURL              string
	JobFetchSmartRecruitersBaseURL string
	JobFetchWorkableBaseURL        string
	// Turnstile* —— Cloudflare Turnstile captcha 配置。两个都设才开启；
	// 任一为空 = captcha 关闭。不是 fallback：env 是这个 opt-in feature 唯一
	// 入口。后续若改 UI-driven 配置（DB-stored），这里整组删。
	TurnstileSiteKey string
	TurnstileSecret  string
	// QueryQueueMaxConcurrent —— visitor chat agent loop 全局并发上限；
	// 防一个 owner 的 anthropic 配额被并发访客打爆。≤0 关闭限流（dev 默认）。
	// env: QUERY_QUEUE_MAX_CONCURRENT
	QueryQueueMaxConcurrent int
	SecureCookie            bool // dev (http) 走 false；prod 必须 true
}

// 缺关键 env 时返回的 sentinel error。
var (
	ErrDatabaseURLRequired = errors.New("DATABASE_URL is required")
	ErrRedisURLRequired    = errors.New("REDIS_URL is required")
)

// Load 读 env，返回 Config 或 error。任何 required env 缺失即返回 error。
func Load() (*Config, error) {
	cfg := &Config{
		Host:                           envOr("HOST", "0.0.0.0"),
		Port:                           envOr("PORT", "8000"),
		DatabaseURL:                    os.Getenv("DATABASE_URL"),
		RedisURL:                       os.Getenv("REDIS_URL"),
		SessionKey:                     os.Getenv("SESSION_KEY"),
		CustomPagesRoot:                envOr("CUSTOM_PAGES_ROOT", "/srv/custom-pages"),
		JobFetchGreenhouseBaseURL:      os.Getenv("GREENHOUSE_BASE_URL"),
		JobFetchLeverBaseURL:           os.Getenv("LEVER_BASE_URL"),
		JobFetchAshbyBaseURL:           os.Getenv("ASHBY_BASE_URL"),
		JobFetchRemoteOKBaseURL:        os.Getenv("REMOTEOK_BASE_URL"),
		JobFetchWWRBaseURL:             os.Getenv("WWR_BASE_URL"),
		JobFetchHNBaseURL:              os.Getenv("HN_BASE_URL"),
		JobFetchSmartRecruitersBaseURL: os.Getenv("SMARTRECRUITERS_BASE_URL"),
		JobFetchWorkableBaseURL:        os.Getenv("WORKABLE_BASE_URL"),
		TurnstileSiteKey:               os.Getenv("TURNSTILE_SITE_KEY"),
		TurnstileSecret:                os.Getenv("TURNSTILE_SECRET"),
		QueryQueueMaxConcurrent:        envInt("QUERY_QUEUE_MAX_CONCURRENT", 0),
		SecureCookie:                   envOr("SECURE_COOKIE", "true") == "true",
	}

	if cfg.DatabaseURL == "" {
		return nil, ErrDatabaseURLRequired
	}
	if cfg.RedisURL == "" {
		return nil, ErrRedisURLRequired
	}
	// SESSION_KEY 只在登录后续阶段才用，启动时允许空。

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envInt —— env 整数 + 默认值；非整数视为 0 (不取 fallback)，让 ops 看见
// 解析失败而不是静默回 default。
func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0
	}
	return n
}
