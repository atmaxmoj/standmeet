// Package config reads server configuration from environment variables.
//
// Deliberately simple by design: read once at startup, never refreshed. The
// owner should not change the DB connection string at runtime. Missing
// required env vars (DATABASE_URL / REDIS_URL) fail fast with no default,
// because local dev also injects them via docker-compose.
package config

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds the runtime configuration read once at process startup.
//
// Deliberately no PublicURL/PUBLIC_URL: removes the env-as-config "outward
// URL" pointer. Each owner's public_url is filled in on the claim form and
// written to the owners row; SEO / QR all read from the DB — no env, no
// default, no fallback.
type Config struct {
	Host        string
	Port        string
	DatabaseURL string
	RedisURL    string
	SessionKey  string
	// root dir for custom page build artifacts: builder writes, backend reads
	CustomPagesRoot string
	// PublicIP — the instance's public IP, shown on the admin System panel. Deploy-provided
	// (the owner's server knows its own public address); empty → the panel shows "—".
	PublicIP string
	// JobFetch*BaseURL — base URL overrides for each job-board adapter. Left
	// empty in production to hit the real URL; e2e/dev point at the
	// external-mock started by docker-compose. See
	// docs/design/job-loop-tests.md T.2.
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
	JobFetchJobicyBaseURL          string
	JobFetchRemotiveBaseURL        string
	JobFetchHimalayasBaseURL       string
	JobFetchWorkingNomadsBaseURL   string
	JobFetchRecruiteeBaseURL       string
	// Turnstile* — Cloudflare Turnstile captcha config. Both must be set to
	// enable it; either being empty disables captcha. Not a fallback: env is
	// the sole entry point for this opt-in feature. If this later moves to
	// UI-driven (DB-stored) config, delete this whole group.
	TurnstileSiteKey string
	TurnstileSecret  string
	// SandboxDriver — the skill-script execution backend: 'docker' or
	// 'disabled'. docker requires the backend container to mount
	// /var/run/docker.sock and have the docker CLI available. Not explicitly
	// enabled = disabled, and skill script calls return sandbox.ErrDisabled.
	// env: SANDBOX_DRIVER
	SandboxDriver string
	// Storage* — MinIO / S3 client config. Empty Endpoint = disabled (asset
	// uploads return storage.ErrDisabled). PublicURL is the host the browser
	// can reach directly (used to swap the host in presigned URLs; inside
	// the container it's minio:9000, from the browser it's localhost:9200).
	StorageEndpoint  string
	StorageAccessKey string
	StorageSecretKey string
	StorageBucket    string
	StoragePublicURL string
	// GotenbergURL / PrintBaseURL — resume PDF rendering config. Both must
	// be set to take effect; either being empty = NoopRenderer, and
	// applications.commit reports ErrNotConfigured.
	//   GOTENBERG_URL  — sidecar HTTP base (compose service "gotenberg")
	//   PRINT_BASE_URL — the base URL the app container exposes to
	//                    gotenberg; the print route is appended after it
	//                    (gotenberg fetches <base>/print/application/<id>?token=…)
	GotenbergURL string
	PrintBaseURL string
	// TypstBin / ResumeFontPath — resume PDF now goes through Typst (typst
	// binary + an embedded template). Empty TypstBin = "typst" on PATH;
	// ResumeFontPath points at the Newsreader + JetBrains Mono font dir (so
	// print uses the same fonts as the web page). See internal/owner/jobs/resumepdf.
	TypstBin       string
	ResumeFontPath string
	// MarketplaceGitHubBaseURL / MarketplaceSkillsMPBaseURL —— skill
	// marketplace upstream overrides. Empty = use real GitHub / SkillsMP.
	// dev/e2e point both at the external-mock service so the search
	// proxy never touches the public internet.
	MarketplaceGitHubBaseURL   string
	MarketplaceSkillsMPBaseURL string
	// Meili* — the corpus lexical-search index (1b crawl face). Both empty =
	// search falls back to Postgres full-text (graceful); write-path index
	// propagation also becomes a no-op. Not required: meili is an optional
	// speed layer, Postgres remains the source of truth. env: MEILI_URL / MEILI_KEY
	MeiliURL string
	MeiliKey string
	// UpgradeSignalPath — the **product-owned, substrate-blind** upgrade path, and the only
	// one. This instance has no control over its host (compose deliberately does not mount
	// docker.sock into backend), so it never pulls images itself: the /admin/system "upgrade"
	// button writes a byte to a file on a volume shared with the bundled updater sidecar, and
	// whichever adapter consumes it does the substrate-specific work (the docker updater runs
	// `docker compose up`; a Coolify adapter would call Coolify). The product does not know or
	// pick the substrate. Ships with the product, so the button works with no owner config.
	// Empty (no sidecar) → the panel reports the button can't act.
	// env: STANDMEET_UPGRADE_SIGNAL
	UpgradeSignalPath string
	// ReleaseRegistry / ReleaseRepo — where to ask "is there a new version".
	// Defaults to the official image registry; people running their own
	// fork change the repo, and dev/e2e point the registry at a local mock
	// (a case that only holds when it can reach the public internet — on a
	// machine with no network it goes red exactly like the product is broken).
	// env: STANDMEET_RELEASE_REGISTRY / STANDMEET_RELEASE_REPO
	ReleaseRegistry string
	ReleaseRepo     string
	// SelfStatPeers — sibling services' /selfstat URLs (comma-separated) the System panel gathers.
	// The backend reads its OWN cgroup directly; each peer reports its own over its endpoint — no
	// docker socket anywhere. Empty → the panel shows just the backend's own row.
	// env: STANDMEET_SELFSTAT_PEERS
	SelfStatPeers []string
	// QueryQueueMaxConcurrent — global concurrency cap for the visitor chat
	// agent loop; guards against concurrent visitors blowing an owner's
	// anthropic quota. ≤0 disables throttling (the dev default).
	// env: QUERY_QUEUE_MAX_CONCURRENT
	QueryQueueMaxConcurrent int
	StorageUseSSL           bool
	SecureCookie            bool // dev (http) uses false; prod must be true
}

// Sentinel errors returned when a required env var is missing.
var (
	ErrDatabaseURLRequired      = errors.New("DATABASE_URL is required")
	ErrRedisURLRequired         = errors.New("REDIS_URL is required")
	ErrStorageEndpointRequired  = errors.New("STORAGE_ENDPOINT is required")
	ErrStorageAccessKeyRequired = errors.New("STORAGE_ACCESS_KEY is required")
	ErrStorageSecretKeyRequired = errors.New("STORAGE_SECRET_KEY is required")
	ErrStorageBucketRequired    = errors.New("STORAGE_BUCKET is required")
)

// Default hosts for internal compose services (private docker network,
// plaintext http is deliberate — never exposed to the public internet).
// Stores only host:port; the scheme is assembled in internalURL, to avoid a
// bare http:// URL literal appearing in source.
const (
	defaultGotenbergHost = "gotenberg:3000"
	defaultPrintHost     = "app:3000"
)

// defaultReleaseRegistry / defaultReleaseRepo — the official image registry;
// `instance.upgrade_check` asks here which versions have been published.
// People who fork and publish their own use those two env vars to override it.
const (
	defaultReleaseRegistry = "https://ghcr.io"
	defaultReleaseRepo     = "atmaxmoj/standmeet-backend"
)

// internalURL assembles the base URL of an internal compose service.
// Plaintext http inside the private docker network is deliberate (these
// services are never exposed to the public internet); the scheme is decided
// in this one place and never appears as a literal.
func internalURL(host string) string {
	return (&url.URL{Scheme: "http", Host: host}).String()
}

// Load reads env vars and returns a Config or an error. Any missing
// required env var returns an error.
func Load() (*Config, error) {
	cfg := &Config{
		Host:                           envOr("HOST", "0.0.0.0"),
		Port:                           envOr("PORT", "8000"),
		DatabaseURL:                    os.Getenv("DATABASE_URL"),
		RedisURL:                       os.Getenv("REDIS_URL"),
		SessionKey:                     os.Getenv("SESSION_KEY"),
		CustomPagesRoot:                envOr("CUSTOM_PAGES_ROOT", "/srv/custom-pages"),
		PublicIP:                       os.Getenv("PUBLIC_IP"),
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
		JobFetchJobicyBaseURL:          os.Getenv("JOBICY_BASE_URL"),
		JobFetchRemotiveBaseURL:        os.Getenv("REMOTIVE_BASE_URL"),
		JobFetchHimalayasBaseURL:       os.Getenv("HIMALAYAS_BASE_URL"),
		JobFetchWorkingNomadsBaseURL:   os.Getenv("WORKING_NOMADS_BASE_URL"),
		JobFetchRecruiteeBaseURL:       os.Getenv("RECRUITEE_BASE_URL"),
		TurnstileSiteKey:               os.Getenv("TURNSTILE_SITE_KEY"),
		TurnstileSecret:                os.Getenv("TURNSTILE_SECRET"),
		QueryQueueMaxConcurrent:        envInt("QUERY_QUEUE_MAX_CONCURRENT", 0),
		MeiliURL:                       os.Getenv("MEILI_URL"),
		MeiliKey:                       os.Getenv("MEILI_KEY"),
		SandboxDriver:                  os.Getenv("SANDBOX_DRIVER"),
		StorageEndpoint:                os.Getenv("STORAGE_ENDPOINT"),
		StorageAccessKey:               os.Getenv("STORAGE_ACCESS_KEY"),
		StorageSecretKey:               os.Getenv("STORAGE_SECRET_KEY"),
		StorageBucket:                  os.Getenv("STORAGE_BUCKET"),
		StoragePublicURL:               os.Getenv("STORAGE_PUBLIC_URL"),
		// #117 deployment-friendly: unset falls back to the standard
		// self-hosted compose service name, so a fresh deploy needs no
		// field-by-field filling.
		TypstBin:                   envOr("TYPST_BIN", "typst"),
		ResumeFontPath:             envOr("RESUME_FONT_PATH", ""),
		GotenbergURL:               envOr("GOTENBERG_URL", internalURL(defaultGotenbergHost)),
		PrintBaseURL:               envOr("PRINT_BASE_URL", internalURL(defaultPrintHost)),
		MarketplaceGitHubBaseURL:   os.Getenv("MARKETPLACE_GITHUB_BASE_URL"),
		MarketplaceSkillsMPBaseURL: os.Getenv("MARKETPLACE_SKILLSMP_BASE_URL"),
		UpgradeSignalPath:          os.Getenv("STANDMEET_UPGRADE_SIGNAL"),
		ReleaseRegistry:            envOr("STANDMEET_RELEASE_REGISTRY", defaultReleaseRegistry),
		ReleaseRepo:                envOr("STANDMEET_RELEASE_REPO", defaultReleaseRepo),
		SelfStatPeers:              splitCSV(os.Getenv("STANDMEET_SELFSTAT_PEERS")),
		StorageUseSSL:              os.Getenv("STORAGE_USE_SSL") == "true",
		SecureCookie:               envOr("SECURE_COOKIE", "true") == "true",
	}

	if verr := validateRequired(cfg); verr != nil {
		return nil, verr
	}
	// SESSION_KEY is only used later in the login flow; empty is allowed at startup.
	return cfg, nil
}

// requiredEnvCheck — one row of the required-env validation table. Field
// order follows govet fieldalignment: error interface (16B) first, string
// (16B) second.
type requiredEnvCheck struct {
	err error
	val string
}

// validateRequired — table-driven required-env validation, keeping Load's
// cyclomatic complexity ≤ 5. SESSION_KEY is not in the table (empty is
// allowed at startup; it's validated on the login path instead).
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

// splitCSV — a comma-separated env into a trimmed list, dropping empties. "" → nil.
func splitCSV(s string) []string {
	var out []string
	for part := range strings.SplitSeq(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// envInt — env integer with a default; a non-integer value is treated as 0
// (not the fallback), so ops sees the parse failure instead of silently
// getting the default.
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
