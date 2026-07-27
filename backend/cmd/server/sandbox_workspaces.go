// sandbox_workspaces.go —— per-session 沙箱工作区子系统接线（#148）。
//
// 建一个 sandboxws.Manager（root 来自 SANDBOX_WORKSPACE_ROOT，默认 /srv/sandbox-
// workspaces），把它的 Provision 注入给 usecases 的沙箱 dial 路径（manifest
// workspace=true 的插件按 conversation_id 懒建工作区 bind 进 /workspace），并起一个 cron
// goroutine 周期清扫过期目录。TTL 后端可控（diag/admin 端点改），cron + on-demand sweep
// 都走 Manager.Sweep。env 未配 root → 跳过（无工作区子系统）。

package main

import (
	"context"
	"os"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const (
	defaultWorkspaceRoot = "/srv/sandbox-workspaces"
	defaultWorkspaceTTL  = time.Hour
	workspaceSweepEvery  = 5 * time.Minute
	// sweepJobName / sweepSchedule —— Monitor job-registry 里这个真 cron 的展示身份。
	sweepJobName  = "sandbox workspace sweep"
	sweepSchedule = "every 5m"
)

func wireSandboxWorkspaces(ctx context.Context, d *runtimeDeps) {
	root := os.Getenv("SANDBOX_WORKSPACE_ROOT")
	if root == "" {
		root = defaultWorkspaceRoot
	}
	mgr, err := sandboxws.New(root, defaultWorkspaceTTL)
	if err != nil {
		// 工作区子系统起不来不该拖垮 boot：记日志、继续（沙箱插件无 /workspace）。
		d.log.Error("sandbox workspaces init", "root", root, "err", err)
		return
	}
	d.sandboxWorkspaces = mgr
	usecases.SetWorkspaceProvisioner(mgr.Provision)
	// Monitor: 登记这个真 cron，并 boot 时跑一次(清上轮残留 + 让 last_run 立刻有值)。
	d.jobRegistry.Register(sweepJobName, sweepSchedule)
	sweepOnce(d, mgr)
	go workspaceSweepLoop(ctx, d, mgr)
}

// workspaceSweepLoop —— cron：每 workspaceSweepEvery 跑一次 Sweep 删过期工作区。
// ctx 取消（进程退出）即停。on-demand sweep 走 diag 端点，不影响这个循环。
func workspaceSweepLoop(ctx context.Context, d *runtimeDeps, mgr *sandboxws.Manager) {
	ticker := time.NewTicker(workspaceSweepEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweepOnce(d, mgr)
		}
	}
}

func sweepOnce(d *runtimeDeps, mgr *sandboxws.Manager) {
	removed, serr := mgr.Sweep()
	if serr != nil {
		d.jobRegistry.Report(sweepJobName, "error")
		d.log.Warn("sandbox workspace cron sweep", "err", serr)
		return
	}
	d.jobRegistry.Report(sweepJobName, "ok")
	if removed > 0 {
		d.log.Info("sandbox workspace cron sweep", "removed", removed)
	}
}
