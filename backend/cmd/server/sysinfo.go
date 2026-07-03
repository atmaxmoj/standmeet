// sysinfo.go —— #101 /admin/system 的真实运行时信息提供者。composition root 持有 db /
// redis / storage 客户端,做真 ping;version/uptime/go runtime 从进程读。adminroutes 只见接口。

package main

import (
	"context"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/storage"
)

// appVersion —— 应用版本(发布时经 ldflags 覆写;dev 走默认)。
const appVersion = "0.1.0"

const bytesPerMB = 1024 * 1024

type sysInfoProvider struct {
	started time.Time
	db      *pgxpool.Pool
	rdb     *redis.Client
	storage *storage.Client
}

func newSysInfoProvider(d *runtimeDeps) *sysInfoProvider {
	return &sysInfoProvider{
		started: time.Now(), db: d.db, rdb: d.rdb, storage: d.storageClient,
	}
}

// SystemInfo —— 真实快照:version/uptime/go runtime + 真 health ping。
func (p *sysInfoProvider) SystemInfo(ctx context.Context) domain.SystemInfo {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	return domain.SystemInfo{
		Version:       appVersion,
		UptimeSeconds: int64(time.Since(p.started).Seconds()),
		Goroutines:    runtime.NumGoroutine(),
		MemAllocMB:    int64(mem.Alloc / bytesPerMB),
		NumCPU:        runtime.NumCPU(),
		Health:        p.healthChecks(ctx),
	}
}

func (p *sysInfoProvider) healthChecks(ctx context.Context) []domain.HealthCheck {
	return []domain.HealthCheck{
		pingCheck("database", "postgres", p.db.Ping(ctx)),
		pingCheck("redis", "job cache + sessions", p.rdb.Ping(ctx).Err()),
		pingCheck("storage", "asset blob storage (minio)", p.storage.Health(ctx)),
	}
}

func pingCheck(name, detail string, err error) domain.HealthCheck {
	return domain.HealthCheck{Name: name, Detail: detail, OK: err == nil}
}
