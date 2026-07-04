// resume_draft_sweep.go —— resume draft 的 1d-TTL 后台清扫 cron。读路径本就 SQL-filter 掉过期行
// (correctness 不依赖它),但没 cron 时过期行会在库里堆着;补这个 sweeper 真删 + 进 jobregistry
// (Monitor jobs 面板多一条真 job)。镜像 workspaceSweepLoop 的结构。

package main

import (
	"context"
	"time"
)

const (
	resumeDraftSweepEvery = time.Hour
	resumeDraftJobName    = "resume-draft sweep"
	resumeDraftSchedule   = "every 1h"
)

// wireResumeDraftSweeper —— 登记 + boot 跑一次(给 last_run 一个确定值)+ 起周期 loop。
func wireResumeDraftSweeper(ctx context.Context, d *runtimeDeps) {
	d.jobRegistry.Register(resumeDraftJobName, resumeDraftSchedule)
	sweepResumeDraftsOnce(ctx, d)
	go resumeDraftSweepLoop(ctx, d)
}

func resumeDraftSweepLoop(ctx context.Context, d *runtimeDeps) {
	ticker := time.NewTicker(resumeDraftSweepEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepResumeDraftsOnce(ctx, d)
		}
	}
}

func sweepResumeDraftsOnce(ctx context.Context, d *runtimeDeps) {
	if err := d.resumeDraftRepo.SweepExpired(ctx); err != nil {
		d.jobRegistry.Report(resumeDraftJobName, "error")
		d.log.Warn("resume-draft cron sweep", "err", err)
		return
	}
	d.jobRegistry.Report(resumeDraftJobName, "ok")
}
