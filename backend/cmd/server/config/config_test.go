package config_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
)

// setRequired —— Load 的 fail-fast 必填项(不填这些 Load 直接报错)。测默认值前先满足。
func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("STORAGE_ENDPOINT", "minio:9000")
	t.Setenv("STORAGE_ACCESS_KEY", "k")
	t.Setenv("STORAGE_SECRET_KEY", "s")
	t.Setenv("STORAGE_BUCKET", "b")
}

// TestLoadDefaultsGotenbergAndPrintBaseURL —— #117 部署友好:GOTENBERG_URL / PRINT_BASE_URL
// 不设时走 prod 默认(标准自托管 compose 服务名),而不是空串(空 = PDF 渲染静默关掉)。
func TestLoadDefaultsGotenbergAndPrintBaseURL(t *testing.T) {
	setRequired(t)
	t.Setenv("GOTENBERG_URL", "")
	t.Setenv("PRINT_BASE_URL", "")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.GotenbergURL != "http://gotenberg:3000" {
		t.Fatalf("GotenbergURL default: got %q", cfg.GotenbergURL)
	}
	if cfg.PrintBaseURL != "http://app:3000" {
		t.Fatalf("PrintBaseURL default: got %q", cfg.PrintBaseURL)
	}
}

// TestLoadGotenbergOverride —— 显式 env 覆写默认(e2e/自定义部署)。
func TestLoadGotenbergOverride(t *testing.T) {
	setRequired(t)
	t.Setenv("GOTENBERG_URL", "http://custom:9999")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if cfg.GotenbergURL != "http://custom:9999" {
		t.Fatalf("override ignored: got %q", cfg.GotenbergURL)
	}
}
