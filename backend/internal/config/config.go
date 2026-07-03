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
	// 留空走真 URL；e2e/dev 指 docker-compose 起的 external-mock。见
	// docs/design/job-loop-tests.md T.2。
	JobFetchGreenhouseBaseURL      string
	JobFetchLeverBaseURL           string
	JobFetchAshbyBaseURL           string
	JobFetchRemoteOKBaseURL        string
	JobFetchWWRBaseURL             string
	JobFetchHNBaseURL              string
	JobFetchSmartRecruitersBaseURL string
	JobFetchWorkableBaseURL        string
	JobFetchJBABaseURL             string
	JobFetchWorkdayBaseURL         string
	JobFetchBambooHRBaseURL        string
	// Turnstile* —— Cloudflare Turnstile captcha 配置。两个都设才开启；
	// 任一为空 = captcha 关闭。不是 fallback：env 是这个 opt-in feature 唯一
	// 入口。后续若改 UI-driven 配置（DB-stored），这里整组删。
	TurnstileSiteKey string
	TurnstileSecret  string
	// SandboxDriver —— skill script 执行后端：'docker' 或 'disabled'。
	// docker 要求 backend 容器 mount /var/run/docker.sock + docker CLI 可用。
	// 不显式开 = disabled，skill 调用脚本时返 sandbox.ErrDisabled。
	// env: SANDBOX_DRIVER
	SandboxDriver string
	// Storage* —— MinIO / S3 客户端配置。Endpoint 空 = 关闭 (assets 上传
	// 返 storage.ErrDisabled)。PublicURL 是浏览器侧能直连的 host (presign
	// URL 里 host 替换用；容器内是 minio:9000，浏览器是 localhost:9200)。
	StorageEndpoint  string
	StorageAccessKey string
	StorageSecretKey string
	StorageBucket    string
	StoragePublicURL string
	// GotenbergURL / PrintBaseURL —— resume PDF 渲染配置。两个都填才生效；
	// 任一为空 = NoopRenderer，applications.commit 报 ErrNotConfigured。
	//   GOTENBERG_URL  — sidecar HTTP base (compose service "gotenberg")
	//   PRINT_BASE_URL — app 容器对 gotenberg 暴露的 base URL，print 路由会
	//                    被拼到这后面（gotenberg 抓 <base>/print/application/<id>?token=…）
	GotenbergURL string
	PrintBaseURL string
	// MarketplaceGitHubBaseURL / MarketplaceSkillsMPBaseURL —— skill
	// marketplace upstream overrides. Empty = use real GitHub / SkillsMP.
	// dev/e2e point both at the external-mock service so the search
	// proxy never touches the public internet.
	MarketplaceGitHubBaseURL   string
	MarketplaceSkillsMPBaseURL string
	// QueryQueueMaxConcurrent —— visitor chat agent loop 全局并发上限；
	// 防一个 owner 的 anthropic 配额被并发访客打爆。≤0 关闭限流（dev 默认）。
	// env: QUERY_QUEUE_MAX_CONCURRENT
	QueryQueueMaxConcurrent int
	StorageUseSSL           bool
	SecureCookie            bool // dev (http) 走 false；prod 必须 true
}

// 缺关键 env 时返回的 sentinel error。
var (
	ErrDatabaseURLRequired      = errors.New("DATABASE_URL is required")
	ErrRedisURLRequired         = errors.New("REDIS_URL is required")
	ErrStorageEndpointRequired  = errors.New("STORAGE_ENDPOINT is required")
	ErrStorageAccessKeyRequired = errors.New("STORAGE_ACCESS_KEY is required")
	ErrStorageSecretKeyRequired = errors.New("STORAGE_SECRET_KEY is required")
	ErrStorageBucketRequired    = errors.New("STORAGE_BUCKET is required")
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
		JobFetchJBABaseURL:             os.Getenv("JBA_BASE_URL"),
		JobFetchWorkdayBaseURL:         os.Getenv("WORKDAY_BASE_URL"),
		JobFetchBambooHRBaseURL:        os.Getenv("BAMBOOHR_BASE_URL"),
		TurnstileSiteKey:               os.Getenv("TURNSTILE_SITE_KEY"),
		TurnstileSecret:                os.Getenv("TURNSTILE_SECRET"),
		QueryQueueMaxConcurrent:        envInt("QUERY_QUEUE_MAX_CONCURRENT", 0),
		SandboxDriver:                  os.Getenv("SANDBOX_DRIVER"),
		StorageEndpoint:                os.Getenv("STORAGE_ENDPOINT"),
		StorageAccessKey:               os.Getenv("STORAGE_ACCESS_KEY"),
		StorageSecretKey:               os.Getenv("STORAGE_SECRET_KEY"),
		StorageBucket:                  os.Getenv("STORAGE_BUCKET"),
		StoragePublicURL:               os.Getenv("STORAGE_PUBLIC_URL"),
		// #117 部署友好:不设时走标准自托管 compose 服务名,fresh deploy 免逐个填。
		GotenbergURL:               envOr("GOTENBERG_URL", "http://gotenberg:3000"),
		PrintBaseURL:               envOr("PRINT_BASE_URL", "http://app:3000"),
		MarketplaceGitHubBaseURL:   os.Getenv("MARKETPLACE_GITHUB_BASE_URL"),
		MarketplaceSkillsMPBaseURL: os.Getenv("MARKETPLACE_SKILLSMP_BASE_URL"),
		StorageUseSSL:              os.Getenv("STORAGE_USE_SSL") == "true",
		SecureCookie:               envOr("SECURE_COOKIE", "true") == "true",
	}

	if verr := validateRequired(cfg); verr != nil {
		return nil, verr
	}
	// SESSION_KEY 只在登录后续阶段才用，启动时允许空。
	return cfg, nil
}

// requiredEnvCheck —— 单条 required env 校验表项。字段顺序按 govet
// fieldalignment：error interface (16B) 先，string (16B) 后。
type requiredEnvCheck struct {
	err error
	val string
}

// validateRequired —— 表驱动 required env 校验，让 Load 保持 cyclo ≤ 5。
// SESSION_KEY 不在表里（启动时允许空，登录路径才校验）。
func validateRequired(cfg *Config) error {
	checks := []requiredEnvCheck{
		{err: ErrDatabaseURLRequired, val: cfg.DatabaseURL},
		{err: ErrRedisURLRequired, val: cfg.RedisURL},
		{err: ErrStorageEndpointRequired, val: cfg.StorageEndpoint},
		{err: ErrStorageAccessKeyRequired, val: cfg.StorageAccessKey},
		{err: ErrStorageSecretKeyRequired, val: cfg.StorageSecretKey},
		{err: ErrStorageBucketRequired, val: cfg.StorageBucket},
	}
	for _, c := range checks {
		if c.val == "" {
			return c.err
		}
	}
	return nil
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
