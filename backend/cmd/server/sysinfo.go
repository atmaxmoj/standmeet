// sysinfo.go —— #101 /admin/system 的真实运行时信息提供者。composition root 持有 db /
// redis / storage 客户端,做真 ping;version/uptime/go runtime 从进程读。adminroutes 只见接口。

package main

import (
	"context"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/atmaxmoj/standmeet/internal/search"
	"github.com/atmaxmoj/standmeet/internal/stats"
	"github.com/atmaxmoj/standmeet/internal/storage"
)

// appVersion —— 应用版本(发布时经 ldflags 覆写;dev 走默认)。
const appVersion = "0.1.0"

const bytesPerMB = 1024 * 1024

// hostDiskPath —— 主机资源监控看这个挂载点(容器/单机部署下即数据盘根)。
const hostDiskPath = "/"

type sysInfoProvider struct {
	started time.Time
	db      *pgxpool.Pool
	rdb     *redis.Client
	storage *storage.Client
	search  *search.Client // corpus 词法检索;nil = 未配 Meili(不进 health 面板)
}

func newSysInfoProvider(d *runtimeDeps) *sysInfoProvider {
	return &sysInfoProvider{
		started: time.Now(), db: d.db, rdb: d.rdb, storage: d.storageClient, search: d.searchClient,
	}
}

// SystemInfo —— 真实快照:version/uptime/go runtime + 真 health ping + 主机资源。
func (p *sysInfoProvider) SystemInfo(ctx context.Context) stats.SystemInfo {
	var goMem runtime.MemStats
	runtime.ReadMemStats(&goMem)
	host := readHostMetrics(ctx)
	return stats.SystemInfo{
		Version:       appVersion,
		UptimeSeconds: int64(time.Since(p.started).Seconds()),
		Goroutines:    runtime.NumGoroutine(),
		MemAllocMB:    int64(goMem.Alloc / bytesPerMB),
		NumCPU:        runtime.NumCPU(),
		DiskTotalMB:   host.diskTotalMB,
		DiskFreeMB:    host.diskFreeMB,
		MemTotalMB:    host.memTotalMB,
		MemUsedMB:     host.memUsedMB,
		LoadAvg1:      host.load1,
		Health:        p.healthChecks(ctx),
	}
}

// hostMetrics —— 主机资源快照(单一 struct 避免 tuple-return 的 lint 拉扯)。
type hostMetrics struct {
	diskTotalMB int64
	diskFreeMB  int64
	memTotalMB  int64
	memUsedMB   int64
	load1       float64
}

// readHostMetrics —— gopsutil 读主机磁盘/内存/负载(跨平台)。best-effort:任一项读失败
// 该项留 0,监控面板不该因取不到就整体挂掉。
func readHostMetrics(ctx context.Context) hostMetrics {
	var h hostMetrics
	if u, err := disk.UsageWithContext(ctx, hostDiskPath); err == nil {
		h.diskTotalMB = int64(u.Total / bytesPerMB)
		h.diskFreeMB = int64(u.Free / bytesPerMB)
	}
	if v, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		h.memTotalMB = int64(v.Total / bytesPerMB)
		h.memUsedMB = int64(v.Used / bytesPerMB)
	}
	if a, err := load.AvgWithContext(ctx); err == nil {
		h.load1 = a.Load1
	}
	return h
}

func (p *sysInfoProvider) healthChecks(ctx context.Context) []stats.HealthCheck {
	checks := []stats.HealthCheck{
		pingCheck("database", "postgres", p.db.Ping(ctx)),
		pingCheck("redis", "job cache + sessions", p.rdb.Ping(ctx).Err()),
		pingCheck("storage", "asset blob storage (minio)", p.storage.Health(ctx)),
	}
	if p.search != nil { // 未配 Meili 就不列;配了则 live ping,down → OK=false(degraded)
		checks = append(checks, pingCheck("meili", "corpus lexical search", p.search.Healthy(ctx)))
	}
	return checks
}

func pingCheck(name, detail string, err error) stats.HealthCheck {
	return stats.HealthCheck{Name: name, Detail: detail, OK: err == nil}
}
