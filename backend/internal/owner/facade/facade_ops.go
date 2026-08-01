// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/owner/ops。

package owner

import "github.com/atmaxmoj/standmeet/internal/owner/ops"

// 操作组（实现:ops）.
var (
	DomainOps = ops.Domains
)
