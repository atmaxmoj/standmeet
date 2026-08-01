// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/access/ops。

package access

import "github.com/atmaxmoj/standmeet/internal/access/ops"

// 类型（实现:ops）.
type (
	CodeExtras = ops.CodeExtras
	OpsCodes   = ops.CodesDeps
)

// 操作组（实现:ops）.
var CodeOps = ops.Codes
