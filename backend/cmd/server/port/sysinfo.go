// sysinfo.go —— #101 /admin/system 的真实运行时信息提供者。composition root 持有 db /
// redis / storage 客户端,做真 ping;version/uptime/go runtime 从进程读。adminroutes 只见接口。

package port

import (
	"context"
	"runtime"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"

	"github.com/atmaxmoj/standmeet/internal/corpus/search"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// appVersion —— 应用版本。**必须是 var**:`-ldflags -X` 只能写 var,写不了 const,
// 所以上一版那句"发布时经 ldflags 覆写"从来没有发生过 —— 它是一个手打的字面量,
// 而前端另有一个手打的 "v1.0.0",两个数字长期互相矛盾(F-C-10)。
//
// 现在这里是**唯一**的那份:前端不再自带常量,它显示的是运行中的进程报的这个值。
var appVersion = "0.1.0"

// AppVersion —— 组装根把这一份也交给公开的 /api/v1/instance。徽标和 /admin/system 的
// DEPLOYMENT 于是读的是同一个进程报的同一个数,而不是各自一份手打的常量(F-C-10)。
func AppVersion() string { return appVersion }

const bytesPerMB = 1024 * 1024

// hostDiskPath —— 主机资源监控看这个挂载点(容器/单机部署下即数据盘根)。
const hostDiskPath = "/"

// SysInfoProvider —— /admin/system 那份运行时信息(真 ping,不是自报)。
type SysInfoProvider struct {
	started time.Time
	db      *pgxpool.Pool
	rdb     *redis.Client
	storage *storage.Client
	search  *search.Client // corpus 词法检索;nil = 未配 Meili(不进 health 面板)
}

// NewSysInfoProvider —— /admin/system 那份运行时信息的提供者(真 ping,不是自报)。
func NewSysInfoProvider(d *deps.Runtime) *SysInfoProvider {
	return &SysInfoProvider{
		started: time.Now(), db: d.DB, rdb: d.RDB, storage: d.StorageClient, search: d.SearchClient,
	}
}

// SystemInfo —— 真实快照:version/uptime/go runtime + 真 health ping + 主机资源。
func (p *SysInfoProvider) SystemInfo(ctx context.Context) stats.SystemInfo {
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

func (p *SysInfoProvider) healthChecks(ctx context.Context) []stats.HealthCheck {
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
