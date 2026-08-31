// main.go —— 进程入口:组装 config、DB pool、Redis、router,然后启 HTTP server。
//
// 任何业务逻辑都不在这里。这里的工作是"把依赖塞进去 + 监听端口 + 优雅退出"。
// 整个目录的分工章程在 doc.go。

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

	// time/tzdata 把 IANA 时区库嵌进二进制 —— 静态 CGO_ENABLED=0 binary 跑在不带 tzdata 的
	// 镜像时 time.LoadLocation("America/Toronto") 这类命名时区否则会失败(booking working-hours
	// 评估对每个候选 slot 报错 → list_slots 永远 0 候选)。嵌进二进制保证任何 owner tz 都能加载。

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
	// **升级就发生在这里** —— 不是某个要人记得跑的独立步骤。
	// 这一版带来的 schema 改动编在同一个二进制里，部署这一版＝打这些改动。
	// 失败就不服务：一个 schema 打了一半的实例会在某条具体查询上炸，
	// 而那个错误指向查询、不指向原因。
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
	// resolver always builds from owner.ai_provider + decrypted key. In
	// dev/e2e the owner's endpoint is seeded to the mock llm-gateway
	// service (see e2e/fixtures/admin.ts seedDevAIProvider).
	// 开封在 ownerLookupAdapter 里做(openAIProviderKey)。这里**不再**往 resolver 注一个
	// 解封闭包 —— 那是一把对任意 owner 都好使的万能钥匙,内核不该拿着它。
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
	// 市场搜索那句「这张卡还缺哪几个连接器」的实现:它持 &rt,到被调用时才去取能力注册表
	// 和依赖注册表 —— 那两张表要等 registerAgentSkills 才齐,而收口比它先装配(F-F-4)。
	rt.ConnectorNeeds = &connectorNeeds{rt: &rt}
	// must precede buildPluginRegistry: owner-MCP caps capture the connector dispatcher there.
	axisconn.EnsureConnectorSlots(&rt)
	// 各能力自己的隔离存储先备好:出站收口(码上的字段)、入站收口(沙箱读写)、用量闸
	// 三条路都从同一份取,provision 只跑这一次。
	axiscap.CapabilityStorageInit(ctx, &rt)
	rt.PluginRegistry = buildPluginRegistry(&rt)
	// 出站收口只建一个:MCP 面和 admin 面必须投影自**同一份**声明,否则 parity 无从谈起。
	rt.Dispatch = wire.BuildDispatcher(&rt)
	registerAgentSkills(ctx, &rt)
	return serve(ctx, &rt, net.JoinHostPort(cfg.Host, cfg.Port), stop)
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

// captchaSiteKeyFor —— site_key 只有 TURNSTILE_SECRET 也设了才往前端吐；
// 任一空都返空串（feature off），跟 NewFromConfig 的 noop 一致。
func captchaSiteKeyFor(cfg *config.Config) string {
	if cfg.TurnstileSiteKey == "" || cfg.TurnstileSecret == "" {
		return ""
	}
	return cfg.TurnstileSiteKey
}

// setupTokenIssuerAdapter —— 把 *owner.InstanceRepo + *session.SetupTokenHolder
// 包成 owner.SetupTokenIssuer。让 /api/v1/instance handler 通过 usecase 拿
// self-healing 的 unclaimed setup token，而 usecase 层不直接 import session 包。
type setupTokenIssuerAdapter struct {
	log    *slog.Logger
	repo   *owner.InstanceRepo
	holder *session.SetupTokenHolder
	// issuing —— 发放要单飞。写 DB hash 和写内存 holder 是两步，两个请求交错一次
	// 就会留下「holder=TA、DB=hash(TB)」这种谁都用不了的组合（F-L-56，真实环境里
	// 咬到过：首页 SSR 每渲一次就问一次 /api/v1/instance，并发是常态不是意外）。
	// 锁住「查一次 + 需要就发一次」这整段，交错就没有落脚的地方。
	issuing sync.Mutex
}

// UsableToken —— 库里那个 hash 和内存这份明文**是不是一对**。是就返它，不是就返空串
// （调用方去重发）。只问「都非空吗」是不够的：那正是坏状态的样子。
func (a *setupTokenIssuerAdapter) UsableToken(ctx context.Context) (string, error) {
	a.issuing.Lock()
	defer a.issuing.Unlock()
	return a.usableLocked(ctx)
}

// IssueAndStore —— 单飞。进来先再查一次：等锁的那几个请求里，第一个已经发过了，
// 剩下的直接用它的结果，不要一人发一份（那既浪费，又让最后一个覆盖掉前面所有人）。
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

// usableLocked —— 上面两个方法共用的那一段：**库里那个 hash 和内存这份明文是不是一对**。
// 调用方已经持锁。
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
		// 明说：这一行是「发出去的链接为什么突然换了一条」的唯一解释。
		a.log.Warn("setup token halves diverged; re-issuing",
			"reason", "in-memory plaintext does not hash to the stored hash")
		return "", nil
	}
	return plaintext, nil
}

// ownerLookupAdapter —— 把 owner.Repo 包成 inference.OwnerLookup。
// resolver 不该直接 import postgres（arch-lint 禁），所以胶水放在 cmd 层。
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

// openAIProviderKey 在 unseal.go —— 开封只在那一个文件里发生。

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
		// 版本进启动日志:"这条日志是哪个 build 打的"必须从日志本身答得出,
		// 不能靠回忆当时线上是哪一版。
		rt.Log.Info("server starting", "addr", srv.Addr, "version", port.AppVersion())
		if lerr := srv.ListenAndServe(); lerr != nil && !errors.Is(lerr, http.ErrServerClosed) {
			rt.Log.Error("listen", "err", lerr)
			stop()
		}
	}()

	<-ctx.Done()
	rt.Log.Info("server stopping")

	// shutdown 用 ctx 派生但去掉 cancel 信号，再加超时；这样 contextcheck
	// 不报"new context"且 graceful shutdown 不会被原 ctx 立即终止。
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), shutdownTimeout)
	defer cancel()
	if serr := srv.Shutdown(shutdownCtx); serr != nil {
		rt.Log.Warn("shutdown", "err", serr)
	}

	return nil
}
