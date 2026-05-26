// Package main 是 standmeet backend 的 composition root：组装 config、DB
// pool、Redis、router，然后启 HTTP server。
//
// 任何业务逻辑都不在这里。这里的工作是 "把依赖塞进去 + 监听端口 + 优雅退出"。
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
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/wangsijie/standmeet/internal/captcha"
	"github.com/wangsijie/standmeet/internal/config"
	"github.com/wangsijie/standmeet/internal/cryptobox"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/jobcache"
	"github.com/wangsijie/standmeet/internal/jobfetch"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/sandbox"
	"github.com/wangsijie/standmeet/internal/server"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/storage"
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
	db, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect pg: %w", err)
	}
	defer db.Close()
	rdb, err := connectRedis(ctx, cfg.RedisURL, log)
	if err != nil {
		return err
	}
	defer closeRedis(log, rdb)
	return wireAndServe(ctx, log, cfg, &conns{db: db, rdb: rdb}, stop)
}

// conns 把基础设施连接打包，让 wireAndServe 满足 argument-limit ≤ 5。
type conns struct {
	db  *pgxpool.Pool
	rdb *redis.Client
}

func wireAndServe(
	ctx context.Context, log *slog.Logger, cfg *config.Config,
	c *conns, stop context.CancelFunc,
) error {
	repos := newRepos(c.db)
	mockProvider, perr := inference.NewFromEnv()
	if perr != nil {
		return fmt.Errorf("init provider: %w", perr)
	}
	// resolver 把 mock 和真 owner-key path 串起来；env=mock 时 e2e 走 mock，
	// 否则按 owner row 的 ai_provider 解密自己的 key 实例化 Anthropic / OpenAI。
	ownerKeyResolver := &inference.OwnerKeyResolver{
		Lookup:    &ownerLookupAdapter{repo: repos.owner},
		Decrypter: cryptobox.Decrypt,
	}
	providerResolver := inference.NewEnvOrOwnerResolver(ownerKeyResolver, mockProvider)
	setupTokenHolder := session.NewSetupTokenHolder()
	if terr := ensureSetupToken(ctx, log, repos.instance, setupTokenHolder); terr != nil {
		return terr
	}
	storageClient, serr := initStorage(ctx, log, cfg)
	if serr != nil {
		return serr
	}
	deps := assembleRuntimeDeps(log, cfg, c, repos, &deferredWiring{
		providerResolver: providerResolver,
		setupTokenHolder: setupTokenHolder,
		storageClient:    storageClient,
	})
	return serve(ctx, &deps, net.JoinHostPort(cfg.Host, cfg.Port), stop)
}

// initStorage —— 启动时 init MinIO + ensure bucket。STORAGE_ENDPOINT 已经
// 在 config.Load 里 required，这里不再 nil 兜底。
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

// ensureSetupToken 在 server 启动前调一次：未 claimed 的 instance 生成
// 新 setup token + 打印到 stdout + 写 /srv/first-run.txt。已 claimed
// 直接 skip。
func ensureSetupToken(
	ctx context.Context,
	log *slog.Logger,
	repo *postgres.InstanceRepo,
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

// runtimeDeps 把 serve 的依赖打包，避免函数参数列表超过 revive argument-limit。
type runtimeDeps struct {
	log               *slog.Logger
	db                *pgxpool.Pool
	rdb               *redis.Client
	instanceRepo      *postgres.InstanceRepo
	ownerRepo         *postgres.OwnerRepo
	tokenRepo         *postgres.APITokenRepo
	rawRepo           *postgres.RawRepo
	wikiRepo          *postgres.WikiRepo
	outputRepo        *postgres.OutputRepo
	codeRepo          *postgres.CodeRepo
	convRepo          *postgres.ConversationRepo
	seoRepo           *postgres.SEORepo
	customPageRepo    *postgres.CustomPageRepo
	customBuildRepo   *postgres.CustomBuildRepo
	accessRequestRepo *postgres.AccessRequestRepo
	jobSourceRepo     *postgres.JobSourceRepo
	resumeDraftRepo   *postgres.ResumeDraftRepo
	applicationRepo   *postgres.ApplicationRepo
	skillRepo         *postgres.SkillRepo
	mcpServerRepo     *postgres.MCPServerRepo
	assetRepo         *postgres.AssetRepo
	postRepo          *postgres.PostRepo
	postLinkRepo      *postgres.PostLinkRepo
	sandboxRunner     sandbox.Runner
	storageClient     *storage.Client
	jobCachePool      *jobcache.Pool
	jobFetchRegistry  *jobfetch.Registry
	sessionStore      *session.OwnerSessionStore
	visitorStore      *session.VisitorSessionStore
	queryQueue        *session.QueryQueue
	providerResolver  inference.Resolver
	setupTokenHolder  *session.SetupTokenHolder
	captchaVerifier   captcha.Verifier
	captchaSiteKey    string
	buildsRoot        string
	secureCookie      bool
}

// captchaSiteKeyFor —— site_key 只有 TURNSTILE_SECRET 也设了才往前端吐；
// 任一空都返空串（feature off），跟 NewFromConfig 的 noop 一致。
func captchaSiteKeyFor(cfg *config.Config) string {
	if cfg.TurnstileSiteKey == "" || cfg.TurnstileSecret == "" {
		return ""
	}
	return cfg.TurnstileSiteKey
}

// setupTokenIssuerAdapter —— 把 *postgres.InstanceRepo + *session.SetupTokenHolder
// 包成 usecases.SetupTokenIssuer。让 /api/v1/instance handler 通过 usecase 拿
// self-healing 的 unclaimed setup token，而 usecase 层不直接 import session 包。
type setupTokenIssuerAdapter struct {
	log    *slog.Logger
	repo   *postgres.InstanceRepo
	holder *session.SetupTokenHolder
}

func (a *setupTokenIssuerAdapter) HasLiveTokenHash(ctx context.Context) (bool, error) {
	inst, err := a.repo.Get(ctx)
	if err != nil {
		return false, fmt.Errorf("get instance settings: %w", err)
	}
	return inst.HasSetupTokenHash, nil
}

func (a *setupTokenIssuerAdapter) IssueAndStore(ctx context.Context) error {
	if err := session.IssueSetupToken(ctx, a.log, a.repo, a.holder); err != nil {
		return fmt.Errorf("issue setup token: %w", err)
	}
	return nil
}

func (a *setupTokenIssuerAdapter) HolderPlaintext() string {
	return a.holder.Plaintext()
}

// ownerLookupAdapter —— 把 postgres.OwnerRepo 包成 inference.OwnerLookup。
// resolver 不该直接 import postgres（arch-lint 禁），所以胶水放在 cmd 层。
type ownerLookupAdapter struct {
	repo *postgres.OwnerRepo
}

func (a *ownerLookupAdapter) LookupForResolver(
	ctx context.Context, ownerID string,
) (inference.OwnerKeyView, error) {
	view, err := a.repo.GetAIProviderView(ctx, ownerID)
	if err != nil {
		return inference.OwnerKeyView{}, fmt.Errorf("owner lookup adapter: %w", err)
	}
	return inference.OwnerKeyView{
		Provider: view.Provider, Endpoint: view.Endpoint, Model: view.Model,
		KeyEnc: view.KeyEnc,
	}, nil
}

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

func serve(ctx context.Context, deps *runtimeDeps, addr string, stop context.CancelFunc) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           server.New(buildServerDeps(deps)),
		ReadHeaderTimeout: httpReadHeaderTimeout,
		ReadTimeout:       httpReadTimeout,
		WriteTimeout:      httpWriteTimeout,
		IdleTimeout:       httpIdleTimeout,
	}

	go func() {
		deps.log.Info("server starting", "addr", srv.Addr)
		if lerr := srv.ListenAndServe(); lerr != nil && !errors.Is(lerr, http.ErrServerClosed) {
			deps.log.Error("listen", "err", lerr)
			stop()
		}
	}()

	<-ctx.Done()
	deps.log.Info("server stopping")

	// shutdown 用 ctx 派生但去掉 cancel 信号，再加超时；这样 contextcheck
	// 不报"new context"且 graceful shutdown 不会被原 ctx 立即终止。
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if serr := srv.Shutdown(shutdownCtx); serr != nil {
		deps.log.Warn("shutdown", "err", serr)
	}

	return nil
}
