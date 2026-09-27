// facade_ops.go -- the things this domain can do externally, re-exported for the convergence point.
//
// Still just a facade: aliases only. Declared in internal/stats/ops.

package stats

import "github.com/atmaxmoj/standmeet/internal/stats/ops"

// Types needed to declare operations (implemented by: ops).
type (
	InstanceDeps     = ops.InstanceDeps
	TasksDeps        = ops.TasksDeps
	SystemInfoSource = ops.SystemInfoSource
	UpgradeDeps      = ops.UpgradeDeps
	UpgradeSources   = ops.UpgradeSources
	ReleaseSource    = ops.ReleaseSource
	Redeploy         = ops.Redeploy
)

// Operation groups (implemented by: ops).
var (
	InstanceOps = ops.Instance
	TasksOps    = ops.Tasks
	EventOps    = ops.Events
	UpgradeOps  = ops.Upgrade
	EventTypes  = ops.EventTypes
)
