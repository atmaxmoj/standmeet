// facade_ops.go —— 本域对外能做的事,再导出给收口。
//
// 门面还是门面:只有别名。声明在 internal/corpus/ops,收口 import 这里把它们汇走。

package corpus

import "github.com/atmaxmoj/standmeet/internal/corpus/ops"

// 操作组（实现:ops）.
var (
	SubjectivityOps = ops.Subjectivity
)
