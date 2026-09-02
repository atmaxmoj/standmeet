package config_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
)

// setRequired — the fail-fast required fields for Load (Load errors out
// immediately if these aren't set). Satisfy them before testing defaults.
func setRequired(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("REDIS_URL", "redis://x")
	t.Setenv("STORAGE_ENDPOINT", "minio:9000")
	t.Setenv("STORAGE_ACCESS_KEY", "k")
	t.Setenv("STORAGE_SECRET_KEY", "s")
	t.Setenv("STORAGE_BUCKET", "b")
}

// TestLoadDefaultsGotenbergAndPrintBaseURL — #117 deployment-friendly:
// GOTENBERG_URL / PRINT_BASE_URL fall back to the prod default (the
// standard self-hosted compose service name) when unset, not an empty
// string (empty = PDF rendering silently disabled).
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

// TestLoadGotenbergOverride — an explicit env var overrides the default
// (e2e / custom deployments).
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
