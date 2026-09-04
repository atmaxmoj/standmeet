// sysinfo.go — #101's real runtime-info provider for /admin/system. The composition
// root holds the db / redis / storage clients and does real pings; version/uptime/go
// runtime are read from the process. adminroutes only sees the interface.

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
	"github.com/atmaxmoj/standmeet/internal/infra/dockerstat"
	"github.com/atmaxmoj/standmeet/internal/infra/storage"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// appVersion — the app version. **Must be a var**: `-ldflags -X` can only write to a
// var, never a const, so the previous version's claim of "overwritten by ldflags at
// release" never actually happened — it was a hand-typed literal, and the frontend
// carried its own separately hand-typed "v1.0.0", the two numbers chronically
// disagreeing (F-C-10).
//
// This is now the **single** copy: the frontend no longer carries its own constant,
// it displays whatever value the running process reports here.
//
// A slot left in place doesn't mean anything sits behind it: the `var` was left for
// ldflags, but the build command never actually carried that flag, so production ran
// a v0.1.3 image while reporting "0.1.0" externally. The version number's **only**
// purpose is to say precisely which build you're on when something goes wrong — a
// number unrelated to the build cancels out that purpose entirely, and is worse than
// having none, because it looks like it knows. Release builds now overwrite it via
// `-X` (backend/Dockerfile's STANDMEET_VERSION).
//
// The default is "dev", not some version number: a copy that was never stamped must
// **look unstamped at a glance**, not disguise itself as some released version.
var appVersion = "dev"

// AppVersion — the composition root also hands this copy to the public
// /api/v1/instance. The badge and /admin/system's DEPLOYMENT thus read the same
// number reported by the same process, instead of each carrying its own
// hand-typed constant (F-C-10).
func AppVersion() string { return appVersion }

const bytesPerMB = 1024 * 1024

// hostDiskPath — the mount point host resource monitoring watches (under
// container/single-machine deploys this is the data disk root).
const hostDiskPath = "/"

// SysInfoProvider — the runtime info shown at /admin/system (real pings, not
// self-reported).
type SysInfoProvider struct {
	started time.Time
	db      *pgxpool.Pool
	rdb     *redis.Client
	storage *storage.Client
	search  *search.Client // corpus lexical search; nil = Meili not configured —
	// **still shows on the health panel**, reported as OK=false (F-S-3)
	docker   *dockerstat.Reader // per-container usage of this compose project; nil = not wired
	publicIP string             // deploy-provided instance public IP (env PUBLIC_IP)
}

// NewSysInfoProvider — provider of the runtime info shown at /admin/system (real
// pings, not self-reported).
func NewSysInfoProvider(d *deps.Runtime) *SysInfoProvider {
	return &SysInfoProvider{
		started: time.Now(), db: d.DB, rdb: d.RDB, storage: d.StorageClient, search: d.SearchClient,
		docker: d.DockerStat, publicIP: d.PublicIP,
	}
}

// SystemInfo — the real snapshot: version/uptime/go runtime + real health pings +
// host resources.
func (p *SysInfoProvider) SystemInfo(ctx context.Context) stats.SystemInfo {
	var goMem runtime.MemStats
	runtime.ReadMemStats(&goMem)
	host := readHostMetrics(ctx)
	return stats.SystemInfo{
		Version:       appVersion,
		PublicIP:      p.publicIP,
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
		Containers:    p.containers(ctx),
	}
}

// dockerStatBudget — the most /admin/system will wait on the docker gather. Container stats
// are a nice-to-have; the rest of the snapshot (health, host metrics) must never be held up.
const dockerStatBudget = 3 * time.Second

// containers — this compose project's per-service usage; nil when the docker socket isn't
// wired/available (the panel then simply shows no cluster rows, not an error).
func (p *SysInfoProvider) containers(ctx context.Context) []stats.Container {
	if p.docker == nil {
		return []stats.Container{}
	}
	ctx, cancel := context.WithTimeout(ctx, dockerStatBudget)
	defer cancel()
	snap, err := p.docker.Snapshot(ctx)
	if err != nil {
		return []stats.Container{}
	}
	out := make([]stats.Container, 0, len(snap))
	for i := range snap {
		out = append(out, stats.Container{
			Name: snap[i].Name, CPUPercent: snap[i].CPUPercent,
			MemBytes: snap[i].MemBytes, MemLimit: snap[i].MemLimit,
		})
	}
	return out
}

// hostMetrics — host resource snapshot (a single struct avoids the tuple-return
// lint tug-of-war).
type hostMetrics struct {
	diskTotalMB int64
	diskFreeMB  int64
	memTotalMB  int64
	memUsedMB   int64
	load1       float64
}

// readHostMetrics — gopsutil reads host disk/memory/load (cross-platform).
// best-effort: if any single item fails to read it stays 0; the monitoring panel
// shouldn't fail entirely just because one item couldn't be fetched.
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
		// Listed alongside the three above — **no longer a conditional addition**.
		// Whether it's configured is the question this row answers, not a condition
		// for whether the row appears at all (F-S-3).
		searchCheck(ctx, p.search),
	}
}

// searchCheck — the lexical search row. **Must be listed even when not configured**
// (F-S-3).
//
// It used to be `if p.search != nil` — the whole row vanished when unconfigured, so
// absence looked identical to "everything's fine" on this table, and absence is
// exactly the degradation itself. By design `corpus_search` is the tool that goes
// through Meili (docs/design/open-work-multi-provider-gas-grep-i18n.md:267); when
// `MEILI_URL` is empty it falls back to Postgres full text, **new writes stop being
// indexed**, and a query in a language the tokenizer can't segment (like Chinese)
// comes back empty outright — invisible to the visitor, because the model's English
// query in the same turn carries the answer anyway. So the owner can go on
// indefinitely not knowing a retrieval method is missing.
//
// OK=false is correct here: this isn't "an optional feature not turned on", it's
// **a capability that exists by design and is currently unavailable**.
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
