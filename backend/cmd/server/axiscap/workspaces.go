// workspaces.go —— per-session 沙箱工作区子系统接线（#148）。
//
// 建一个 sandboxws.Manager（root 来自 SANDBOX_WORKSPACE_ROOT，默认 /srv/sandbox-
// workspaces），把它的 Provision 注入给 usecases 的沙箱 dial 路径（manifest
// workspace=true 的插件按 conversation_id 懒建工作区 bind 进 /workspace）。TTL 后端可控
// （diag/admin 端点改）。env 未配 root → 跳过（无工作区子系统）。
//
// 过期目录的周期清扫**不在这儿**:那是 sandboxws 自己的声明(它自己的 periodic.go),
// 组装根只负责把它跟别处的声明一起交给调度。

package axiscap

import (
	"os"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/sandboxws"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

const (
	defaultWorkspaceRoot = "/srv/sandbox-workspaces"
	defaultWorkspaceTTL  = time.Hour
)

// SandboxWorkspaces —— 建 per-session 沙箱工作区子系统并注入分配器。
func SandboxWorkspaces(d *deps.Runtime) {
	root := os.Getenv("SANDBOX_WORKSPACE_ROOT")
	if root == "" {
		root = defaultWorkspaceRoot
	}
	mgr, err := sandboxws.New(root, defaultWorkspaceTTL)
	if err != nil {
		// 工作区子系统起不来不该拖垮 boot：记日志、继续（沙箱插件无 /workspace）。
		d.Log.Error("sandbox workspaces init", "root", root, "err", err)
		return
	}
	d.SandboxWorkspaces = mgr
	capload.SetWorkspaceProvisioner(mgr.Provision)
	// 清扫由 mgr 自己声明(sandboxws.PeriodicJobs),wirePeriodicJobs 汇总起调度。
}
