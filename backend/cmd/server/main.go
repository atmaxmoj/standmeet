// main.go —— process entry point: assembles config, DB pool, Redis, router, starts
// the HTTP server. No business logic here; see doc.go for the directory's layout.

package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/atmaxmoj/standmeet/cmd/server/axiscap"
	"github.com/atmaxmoj/standmeet/cmd/server/axisconn"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	"github.com/atmaxmoj/standmeet/cmd/server/wire"

	// time/tzdata embeds the IANA tz database in the binary — without it a static
	// CGO_ENABLED=0 image with no tzdata fails to load named zones like
	// time.LoadLocation("America/Toronto") (list_slots then returns 0 candidates).

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/cmd/server/config"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const (
	httpReadHeaderTimeout = 10 * time.Second
	httpReadTimeout       = 30 * time.Second
	httpWriteTimeout      = 30 * time.Second
	httpIdleTimeout       = 120 * time.Second
	shutdownTimeout       = 10 * time.Second
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(log)

	if code := versionSubcommand(); code >= 0 {
		os.Exit(code)
	}

	if code := passwordResetSubcommand(log); code >= 0 {
		os.Exit(code)
	}

	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	return runWithCfg(ctx, log, cfg, stop)
}

func runWithCfg(
	ctx context.Context, log *slog.Logger, cfg *config.Config, stop context.CancelFunc,
) error {
	db, err := pgstore.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect pg: %w", err)
	}
	defer db.Close()
	// **The upgrade happens right here**, not as a separate step someone must
	// remember. Schema changes are compiled into this binary; deploying it *is*
	// applying them. On failure we refuse to serve, rather than let a half-applied
	// schema blow up later on some unrelated query.
	if merr := pgstore.Migrate(ctx, db, log); merr != nil {
		return fmt.Errorf("migrate schema: %w", merr)
	}
	rdb, err := connectRedis(ctx, cfg.RedisURL, log)
	if err != nil {
		return err
	}
	defer closeRedis(log, rdb)
	return wireAndServe(ctx, log, cfg, &conns{db: db, rdb: rdb}, stop)
}

// conns bundles the infrastructure connections, keeping wireAndServe within the
// argument-limit ≤ 5.
type conns struct {
	db  *pgxpool.Pool
	rdb *redis.Client
}

func wireAndServe(
	ctx context.Context, log *slog.Logger, cfg *config.Config,
	c *conns, stop context.CancelFunc,
) error {
	repos := newRepos(c.db)
	// resolver always builds from owner.ai_provider + decrypted key (in dev/e2e the
	// owner's endpoint is seeded to the mock llm-gateway; see
	// e2e/fixtures/admin.ts seedDevAIProvider). Unsealing happens inside
	// ownerLookupAdapter (openAIProviderKey) — the resolver no longer takes an
	// unsealing closure, which would be a skeleton key working on any owner.
	providerResolver := &inference.OwnerKeyResolver{
		Lookup: &ownerLookupAdapter{repo: repos.owner},
	}
	setupTokenHolder := session.NewSetupTokenHolder()
	if terr := ensureSetupToken(ctx, log, repos.instance, setupTokenHolder); terr != nil {
		return terr
	}
	storageClient, serr := initStorage(ctx, log, cfg)
	if serr != nil {
		return serr
	}
	rt := assembleRuntimeDeps(log, cfg, c, repos, &deferredWiring{
		providerResolver: providerResolver,
		setupTokenHolder: setupTokenHolder,
		storageClient:    storageClient,
	})
	// Implements marketplace-search's "which connectors is this card still missing":
	// holds &rt, fetches the capability + dependency registries only when invoked,
	// since neither is complete until registerAgentSkills runs (F-F-4).
	rt.ConnectorNeeds = &connectorNeeds{rt: &rt}
	// must precede buildPluginRegistry: owner-MCP caps capture the connector dispatcher there.
	axisconn.EnsureConnectorSlots(&rt)
	// Provisions each capability's isolated storage once; the outbound convergence
	// point (fields on the code), the inbound one (sandbox reads/writes), and the
	// usage gate all draw from this same storage.
	axiscap.CapabilityStorageInit(ctx, &rt)
	rt.PluginRegistry = buildPluginRegistry(&rt)
	// One outbound convergence point: MCP face and admin face must project from
	// **the same** declaration, or there's no basis for parity between them.
	rt.Dispatch = wire.BuildDispatcher(&rt)
	registerAgentSkills(ctx, &rt)
	return serve(ctx, &rt, net.JoinHostPort(cfg.Host, cfg.Port), stop)
}

// initStorage —— inits MinIO + ensures the bucket exists at startup.
// STORAGE_ENDPOINT is already required in config.Load, so this no longer needs a
// nil fallback.
func initStorage(
	ctx context.Context, log *slog.Logger, cfg *config.Config,
) (*storage.Client, error) {
	client, err := storage.NewClient(ctx, &storage.Config{
		Endpoint:  cfg.StorageEndpoint,
		AccessKey: cfg.StorageAccessKey,
		SecretKey: cfg.StorageSecretKey,
		Bucket:    cfg.StorageBucket,
		PublicURL: cfg.StoragePublicURL,
		UseSSL:    cfg.StorageUseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("init storage: %w", err)
	}
	log.Info("storage initialized",
		"endpoint", cfg.StorageEndpoint, "bucket", cfg.StorageBucket)
	return client, nil
}

// ensureSetupToken runs once before the server starts: an unclaimed instance gets a
// new setup token (stdout + /srv/first-run.txt); a claimed instance skips this.
func ensureSetupToken(
	ctx context.Context,
	log *slog.Logger,
	repo *owner.InstanceRepo,
	holder *session.SetupTokenHolder,
) error {
	inst, err := repo.Get(ctx)
	if err != nil {
		return fmt.Errorf("get instance settings: %w", err)
	}
	if inst.IsClaimed {
		log.Info("instance already claimed; setup token skipped")
		return nil
	}
	if terr := session.IssueSetupToken(ctx, log, repo, holder); terr != nil {
		return fmt.Errorf("issue setup token: %w", terr)
	}
	return nil
}

// captchaSiteKeyFor —— site_key goes to the frontend only when TURNSTILE_SECRET is
// also set; either empty returns "" (feature off), matching NewFromConfig's noop.
func captchaSiteKeyFor(cfg *config.Config) string {
	if cfg.TurnstileSiteKey == "" || cfg.TurnstileSecret == "" {
		return ""
	}
	return cfg.TurnstileSiteKey
}

// setupTokenIssuerAdapter —— wraps *owner.InstanceRepo + *session.SetupTokenHolder
// into an owner.SetupTokenIssuer, letting the /api/v1/instance handler self-heal an
// unclaimed setup token through the usecase without importing session directly.
type setupTokenIssuerAdapter struct {
	log    *slog.Logger
	repo   *owner.InstanceRepo
	holder *session.SetupTokenHolder
	// issuing —— issuance must be singleflight: writing the DB hash and the in-memory
	// holder are two steps, and letting two requests interleave once leaves an
	// unusable "holder=TA, DB=hash(TB)" combo (F-L-56, hit for real: homepage SSR
	// calls /api/v1/instance on every render, so concurrency here is the norm).
	// Locking the whole check-then-issue section removes the interleaving window.
	issuing sync.Mutex
}

// UsableToken —— does the DB hash match this in-memory plaintext? Returns the
// plaintext if so, else empty (caller re-issues). Checking "both non-empty" isn't
// enough — that's exactly what the broken state looks like too.
func (a *setupTokenIssuerAdapter) UsableToken(ctx context.Context) (string, error) {
	a.issuing.Lock()
	defer a.issuing.Unlock()
	return a.usableLocked(ctx)
}

// IssueAndStore —— singleflight. Rechecks on entry: of the requests that were
// waiting on the lock, the first already issued a token, so the rest reuse it
// instead of each issuing their own (wasted work, and the last would overwrite it).
func (a *setupTokenIssuerAdapter) IssueAndStore(ctx context.Context) (string, error) {
	a.issuing.Lock()
	defer a.issuing.Unlock()
	if usable, err := a.usableLocked(ctx); err == nil && usable != "" {
		return usable, nil
	}
	if err := session.IssueSetupToken(ctx, a.log, a.repo, a.holder); err != nil {
		return "", fmt.Errorf("issue setup token: %w", err)
	}
	return a.holder.Plaintext(), nil
}

// usableLocked —— shared by the two methods above: does the DB hash match this
// in-memory plaintext? Caller already holds the lock.
func (a *setupTokenIssuerAdapter) usableLocked(ctx context.Context) (string, error) {
	inst, err := a.repo.Get(ctx)
	if err != nil {
		return "", fmt.Errorf("get instance settings: %w", err)
	}
	plaintext := a.holder.Plaintext()
	if inst.SetupTokenHash == "" || plaintext == "" {
		return "", nil
	}
	if session.HashSetupToken(plaintext) != inst.SetupTokenHash {
		// The only explanation for "why did the link that went out suddenly change".
		a.log.Warn("setup token halves diverged; re-issuing",
			"reason", "in-memory plaintext does not hash to the stored hash")
		return "", nil
	}
	return plaintext, nil
}

// ownerLookupAdapter —— wraps owner.Repo into an inference.OwnerLookup. The resolver
// shouldn't import postgres directly (arch-lint forbids it), so this glue lives here.
type ownerLookupAdapter struct {
	repo *owner.Repo
}

func (a *ownerLookupAdapter) LookupForResolver(
	ctx context.Context, ownerID, providerID string,
) (inference.OwnerKeyView, error) {
	view, err := a.repo.ProviderViewByID(ctx, ownerID, providerID)
	if err != nil {
		return inference.OwnerKeyView{}, fmt.Errorf("owner lookup adapter: %w", err)
	}
	key, kerr := openAIProviderKey(ownerID, view.KeyEnc)
	if kerr != nil {
		return inference.OwnerKeyView{}, kerr
	}
	return inference.OwnerKeyView{
		Provider: view.Provider, Endpoint: view.Endpoint, Model: view.Model,
		Key: key,
	}, nil
}

// openAIProviderKey lives in unseal.go —— unsealing only happens in that one file.

func connectRedis(ctx context.Context, redisURL string, log *slog.Logger) (*redis.Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb := redis.NewClient(opts)
	if perr := rdb.Ping(ctx).Err(); perr != nil {
		if cerr := rdb.Close(); cerr != nil {
			log.Warn("redis close during failed connect", "err", cerr)
		}
		return nil, fmt.Errorf("redis ping: %w", perr)
	}
	return rdb, nil
}

func closeRedis(log *slog.Logger, rdb *redis.Client) {
	if err := rdb.Close(); err != nil {
		log.Warn("redis close", "err", err)
	}
}

func serve(ctx context.Context, rt *deps.Runtime, addr string, stop context.CancelFunc) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           New(buildServerDeps(rt)),
		ReadHeaderTimeout: httpReadHeaderTimeout,
		ReadTimeout:       httpReadTimeout,
		WriteTimeout:      httpWriteTimeout,
		IdleTimeout:       httpIdleTimeout,
	}

	rt.Log.Info("plugins enabled", "names", rt.PluginRegistry.Names())

	go func() {
		// Version goes in the startup log so "which build produced this log" is
		// answerable from the log itself, not from memory.
		rt.Log.Info("server starting", "addr", srv.Addr, "version", port.AppVersion())
		if lerr := srv.ListenAndServe(); lerr != nil && !errors.Is(lerr, http.ErrServerClosed) {
			rt.Log.Error("listen", "err", lerr)
			stop()
		}
	}()

	<-ctx.Done()
	rt.Log.Info("server stopping")

	// Derives from ctx but strips its cancel signal, then adds a timeout: keeps
	// contextcheck from flagging a "new context", and shutdown isn't killed by ctx.
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if serr := srv.Shutdown(shutdownCtx); serr != nil {
		rt.Log.Warn("shutdown", "err", serr)
	}

	return nil
}
