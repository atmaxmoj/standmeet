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
	"github.com/wangsijie/standmeet/internal/postgres"
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

	instanceRepo := postgres.NewInstanceRepo(db)
	ownerRepo := postgres.NewOwnerRepo(db)
	sessionStore := session.NewOwnerSessionStore(rdb)
	if terr := ensureSetupToken(ctx, log, instanceRepo, cfg.PublicURL); terr != nil {
		return terr
	}

	addr := net.JoinHostPort(cfg.Host, cfg.Port)
	deps := runtimeDeps{
		log: log, db: db, rdb: rdb,
		instanceRepo: instanceRepo, ownerRepo: ownerRepo, sessionStore: sessionStore,
	}
	return serve(ctx, deps, addr, stop)
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
	log          *slog.Logger
	db           *pgxpool.Pool
	rdb          *redis.Client
	instanceRepo *postgres.InstanceRepo
	ownerRepo    *postgres.OwnerRepo
	sessionStore *session.OwnerSessionStore
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

func serve(ctx context.Context, deps runtimeDeps, addr string, stop context.CancelFunc) error {
	srv := &http.Server{
		Addr: addr,
		Handler: server.New(server.Deps{
			DB:    deps.db,
			Redis: deps.rdb,
			Log:   deps.log,
			Admin: server.AdminDeps{
				Claim: usecases.ClaimDeps{Instance: deps.instanceRepo},
				Login: usecases.LoginDeps{
					Owners:   deps.ownerRepo,
					Sessions: deps.sessionStore,
				},
				Sessions: deps.sessionStore,
			},
		}),
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
