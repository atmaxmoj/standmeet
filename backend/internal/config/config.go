// Package config 从环境变量读 server 配置。
//
// 设计上故意简单：一次读完、不刷新。Owner 不该在运行时改 DB 连接串。
// 缺失关键 env（DATABASE_URL / REDIS_URL）直接 fail-fast，不给 default
// 因为本地 dev 也通过 docker-compose 注入。
package config

import (
	"errors"
	"os"
)

// Config 持有进程启动时一次性读完的运行时配置。
type Config struct {
	Host        string
	Port        string
	DatabaseURL string
	RedisURL    string
	SessionKey  string
}

// 缺关键 env 时返回的 sentinel error。
var (
	ErrDatabaseURLRequired = errors.New("DATABASE_URL is required")
	ErrRedisURLRequired    = errors.New("REDIS_URL is required")
)

// Load 读 env，返回 Config 或 error。任何 required env 缺失即返回 error。
func Load() (*Config, error) {
	cfg := &Config{
		Host:        envOr("HOST", "0.0.0.0"),
		Port:        envOr("PORT", "8000"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		RedisURL:    os.Getenv("REDIS_URL"),
		SessionKey:  os.Getenv("SESSION_KEY"),
	}

	if cfg.DatabaseURL == "" {
		return nil, ErrDatabaseURLRequired
	}
	if cfg.RedisURL == "" {
		return nil, ErrRedisURLRequired
	}
	// SESSION_KEY 是 M3 才用，M1 允许空。

	return cfg, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
