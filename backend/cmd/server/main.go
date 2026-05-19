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

	"github.com/wangsijie/standmeet/internal/config"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/mcp"
	"github.com/wangsijie/standmeet/internal/postgres"
	publicroutes "github.com/wangsijie/standmeet/internal/routes/public"
	sysroutes "github.com/wangsijie/standmeet/internal/routes/sys"
	"github.com/wangsijie/standmeet/internal/server"
	"github.com/wangsijie/standmeet/internal/session"
	"github.com/wangsijie/standmeet/internal/usecases"
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
	instanceRepo := postgres.NewInstanceRepo(c.db)
	ownerRepo := postgres.NewOwnerRepo(c.db)
	tokenRepo := postgres.NewAPITokenRepo(c.db)
	rawRepo := postgres.NewRawRepo(c.db)
	wikiRepo := postgres.NewWikiRepo(c.db)
	codeRepo := postgres.NewCodeRepo(c.db)
	convRepo := postgres.NewConversationRepo(c.db)
	pageRepo := postgres.NewPageRepo(c.db)
	seoRepo := postgres.NewSEORepo(c.db)
	customPageRepo := postgres.NewCustomPageRepo(c.db)
	customBuildRepo := postgres.NewCustomBuildRepo(c.db)
	accessRequestRepo := postgres.NewAccessRequestRepo(c.db)
	sessionStore := session.NewOwnerSessionStore(c.rdb)
	visitorStore := session.NewVisitorSessionStore(c.rdb)
	provider, perr := inference.NewFromEnv()
	if perr != nil {
		return fmt.Errorf("init provider: %w", perr)
	}
	if terr := ensureSetupToken(ctx, log, instanceRepo, cfg.PublicURL); terr != nil {
		return terr
	}

	addr := net.JoinHostPort(cfg.Host, cfg.Port)
	deps := runtimeDeps{
		log: log, db: c.db, rdb: c.rdb,
		instanceRepo: instanceRepo, ownerRepo: ownerRepo,
		tokenRepo: tokenRepo, rawRepo: rawRepo, wikiRepo: wikiRepo,
		codeRepo: codeRepo, convRepo: convRepo, pageRepo: pageRepo,
		seoRepo:           seoRepo,
		customPageRepo:    customPageRepo,
		customBuildRepo:   customBuildRepo,
		accessRequestRepo: accessRequestRepo,
		sessionStore:      sessionStore, visitorStore: visitorStore,
		provider: provider, secureCookie: cfg.SecureCookie,
		publicURL:  cfg.PublicURL,
		buildsRoot: cfg.CustomPagesRoot,
	}
	return serve(ctx, &deps, addr, stop)
}

// ensureSetupToken 在 server 启动前调一次：未 claimed 的 instance 生成
// 新 setup token + 打印到 stdout + 写 /srv/first-run.txt。已 claimed
// 直接 skip。
func ensureSetupToken(
	ctx context.Context,
	log *slog.Logger,
	repo *postgres.InstanceRepo,
	publicURL string,
) error {
	inst, err := repo.Get(ctx)
	if err != nil {
		return fmt.Errorf("get instance settings: %w", err)
	}
	if inst.IsClaimed {
		log.Info("instance already claimed; setup token skipped")
		return nil
	}
	if terr := session.IssueSetupToken(ctx, log, repo, publicURL); terr != nil {
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
	codeRepo          *postgres.CodeRepo
	convRepo          *postgres.ConversationRepo
	pageRepo          *postgres.PageRepo
	seoRepo           *postgres.SEORepo
	customPageRepo    *postgres.CustomPageRepo
	customBuildRepo   *postgres.CustomBuildRepo
	accessRequestRepo *postgres.AccessRequestRepo
	sessionStore      *session.OwnerSessionStore
	visitorStore      *session.VisitorSessionStore
	provider          inference.Provider
	publicURL         string
	buildsRoot        string
	secureCookie      bool
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

// buildServerDeps —— 把每个 sub-router 的 Deps 块组装出来。serve() 不再
// 直接铺开 50+ 行 struct literal，function-length lint 友好。
func buildServerDeps(d *runtimeDeps) *server.Deps {
	return &server.Deps{
		DB:                   d.db,
		Redis:                d.rdb,
		Log:                  d.log,
		Admin:                buildAdminDeps(d),
		Public:               buildPublicDeps(d),
		PublicPage:           buildPublicPageDeps(d),
		PublicSEO:            buildPublicSEODeps(d),
		PublicCustomPages:    buildPublicCustomPageDeps(d),
		PublicAccessRequests: buildPublicAccessRequestsDeps(d),
		Builds:               sysroutes.BuilderDeps{Log: d.log, Builds: d.customBuildRepo},
		TLSAsk:               sysroutes.TLSAskDeps{Log: d.log, Domains: d.instanceRepo},
		MCP:                  buildMCPDeps(d),
	}
}

func buildAdminDeps(d *runtimeDeps) server.AdminDeps {
	return server.AdminDeps{
		Claim:          usecases.ClaimDeps{Instance: d.instanceRepo},
		Login:          usecases.LoginDeps{Owners: d.ownerRepo, Sessions: d.sessionStore},
		APITokens:      usecases.APITokenDeps{Tokens: d.tokenRepo, Log: d.log},
		Corpus:         usecases.CorpusDeps{Raw: d.rawRepo, Wiki: d.wikiRepo},
		Conversations:  usecases.ConversationsDeps{Conv: d.convRepo},
		BYOAI:          usecases.BYOAIDeps{Owners: d.ownerRepo},
		Domains:        usecases.AllowedDomainsDeps{Instance: d.instanceRepo},
		AccessRequests: usecases.AccessRequestsDeps{Repo: d.accessRequestRepo, Owners: d.ownerRepo},
		HandleAdmin:    usecases.HandleDeps{Owners: d.ownerRepo},
		Codes:          d.codeRepo,
		Pages:          d.pageRepo,
		Sessions:       d.sessionStore,
		SecureCookie:   d.secureCookie,
	}
}

func buildPublicDeps(d *runtimeDeps) publicroutes.Handlers {
	return publicroutes.Handlers{
		Visitor: usecases.VisitorDeps{
			Codes: d.codeRepo, Conv: d.convRepo, Wiki: d.wikiRepo,
			Owners: d.ownerRepo, Sessions: d.visitorStore, Provider: d.provider,
		},
		Sessions: d.visitorStore,
		Log:      d.log,
	}
}

func buildPublicPageDeps(d *runtimeDeps) publicroutes.PageHandlers {
	return publicroutes.PageHandlers{
		Page: usecases.PageDeps{Owners: d.ownerRepo, Pages: d.pageRepo},
		Log:  d.log,
	}
}

func buildPublicSEODeps(d *runtimeDeps) publicroutes.SEOHandlers {
	return publicroutes.SEOHandlers{
		Deps:      usecases.SEODeps{Owners: d.ownerRepo, SEO: d.seoRepo},
		Log:       d.log,
		PublicURL: d.publicURL,
	}
}

func buildPublicCustomPageDeps(d *runtimeDeps) publicroutes.CustomPageHandlers {
	return publicroutes.CustomPageHandlers{
		Deps:       usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Owners:     d.ownerRepo,
		Log:        d.log,
		BuildsRoot: d.buildsRoot,
	}
}

func buildPublicAccessRequestsDeps(d *runtimeDeps) publicroutes.AccessRequestsHandlers {
	return publicroutes.AccessRequestsHandlers{
		Reqs: usecases.AccessRequestsDeps{Repo: d.accessRequestRepo, Owners: d.ownerRepo},
		Log:  d.log,
	}
}

func buildMCPDeps(d *runtimeDeps) mcp.Deps {
	return mcp.Deps{
		APITokens:   usecases.APITokenDeps{Tokens: d.tokenRepo, Log: d.log},
		Owners:      d.ownerRepo,
		Corpus:      usecases.CorpusDeps{Raw: d.rawRepo, Wiki: d.wikiRepo},
		SEO:         d.seoRepo,
		CustomPages: usecases.CustomPageDeps{Pages: d.customPageRepo, Builds: d.customBuildRepo},
		Log:         d.log,
	}
}
