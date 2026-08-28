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
//
// 插槽留着不等于插槽后面有东西:`var` 是为 ldflags 留的,而构建命令里一直没有那一句,
// 于是线上跑着 v0.1.3 的镜像、对外报 "0.1.0"。版本号的**唯一**用处是出事时说得清
// 自己在哪个 build —— 一个跟 build 无关的数把这个用处整个抵消,比没有更坏,因为它看起来
// 像知道。发布构建现在会 `-X` 覆写它(backend/Dockerfile 的 STANDMEET_VERSION)。
//
// 缺省值写 "dev" 而不是某个版本号:没盖过章的那一份必须**一眼看得出没盖过**,
// 而不是伪装成某个已发布的版本。
var appVersion = "dev"

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
	search  *search.Client // corpus 词法检索;nil = 未配 Meili —— **仍然进 health 面板**,报 OK=false(F-S-3)
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
	return []stats.HealthCheck{
		pingCheck("database", "postgres", p.db.Ping(ctx)),
		pingCheck("redis", "job cache + sessions", p.rdb.Ping(ctx).Err()),
		pingCheck("storage", "asset blob storage (minio)", p.storage.Health(ctx)),
		// 跟上面三项并列 —— **不再是条件追加**。它有没有配好是这一行要回答的问题,
		// 不是它出不出现的条件(F-S-3)。
		searchCheck(ctx, p.search),
	}
}

// searchCheck —— 词法检索这一项。**没配也要列**(F-S-3)。
//
// 原来是 `if p.search != nil` —— 没配就整条不出现,于是缺席跟"一切正常"在这张表上长得一模一样,
// 而缺席正是降级本身。设计里 `corpus_search` 就是走 Meili 的那个工具
// (docs/design/open-work-multi-provider-gas-grep-i18n.md:267);`MEILI_URL` 空时它退到 Postgres
// 全文、**写入不再索引**,而中文这类分词器切不动的查询会直接返回空 —— 访客那一侧看不出异常,
// 因为模型同轮发的英文查询把答案撑住了。owner 因此可以一直不知道自己少了一个检索法。
//
// OK=false 是对的:这不是"可选功能没开",是**一个按设计存在的能力当前不可用**。
func searchCheck(ctx context.Context, s *search.Client) stats.HealthCheck {
	if s == nil {
		return stats.HealthCheck{
			Name: "search", OK: false,
			Detail: "no lexical index attached — corpus search fell back to Postgres full text, " +
				"and new writes are not being indexed",
		}
	}
	return pingCheck("search", "corpus lexical search (meili)", s.Healthy(ctx))
}

func pingCheck(name, detail string, err error) stats.HealthCheck {
	return stats.HealthCheck{Name: name, Detail: detail, OK: err == nil}
}
