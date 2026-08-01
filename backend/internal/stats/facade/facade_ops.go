// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/stats/ops。

package stats

import "github.com/atmaxmoj/standmeet/internal/stats/ops"

// 声明操作时要的类型（实现:ops）.
type (
	InstanceDeps     = ops.InstanceDeps
	SystemInfoSource = ops.SystemInfoSource
)

// 操作组（实现:ops）.
var InstanceOps = ops.Instance
