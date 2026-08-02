// wire_periodic.go —— 汇齐各处**声明**的周期任务,交给宿主那一份调度起。
//
// 这里替代了两段手写的 cron(resume_draft_sweep.go 和工作区接线里的清扫循环)
// 加一段**根本没登记过**的循环(corpus 的 Meili reconcile —— 它一直在跑,Monitor 面板上却
// 从来没有它)。三段各写一遍 ticker、各写一遍 Register/Report、各手写一句 "every 5m"。
//
// 现在:做什么由声明它的那一方给,多久一次和簿记归 internal/infra/periodic。这个文件只负责
// 把声明汇起来 —— 一个来源一行。

package main

import (
	"context"
	"errors"
	"fmt"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// wirePeriodicJobs —— 收齐 + 起。
func wirePeriodicJobs(ctx context.Context, d *runtimeDeps) {
	periodic.Start(ctx, d.jobRegistry, d.log, collectPeriodicJobs(d))
}

// collectPeriodicJobs —— 一个来源一行。
func collectPeriodicJobs(d *runtimeDeps) []periodic.Job {
	jobs := d.pluginRegistry.AllPeriodicJobs()
	jobs = append(jobs, corpus.IndexPeriodicJobs(d.corpusIndexer, soleOwnerID(d))...)
	if d.sandboxWorkspaces != nil {
		jobs = append(jobs, d.sandboxWorkspaces.PeriodicJobs()...)
	}
	return jobs
}

// soleOwnerID —— 把 owner 域的"本实例那个 owner"翻成 corpus 认识的窄口。翻译落在组装根:
// corpus 不认识 owner 域,owner 域也不该知道谁在定期重建索引。
//
// 还没 claim(ErrOwnerNotFound)翻成空串而不是 error:那是一台崭新实例的正常状态,不是故障。
// 别的失败照实往上报 —— 一次真的读不到 owner 该在面板上看得见。
func soleOwnerID(d *runtimeDeps) corpus.SoleOwnerID {
	return func(ctx context.Context) (string, error) {
		row, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.ownerRepo})
		if errors.Is(err, owner.ErrOwnerNotFound) {
			return "", nil
		}
		if err != nil {
			return "", fmt.Errorf("sole owner: %w", err)
		}
		return row.ID, nil
	}
}
