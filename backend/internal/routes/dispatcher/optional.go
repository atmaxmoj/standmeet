// optional.go —— 三态入参的别名。定义在 internal/infra/facadeparity(域声明操作时
// 要解同样的参,那边不能反过来依赖路由)。还没搬进域的那几个资源在用这些名字。

package dispatcher

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

type (
	// OptionalInt32 —— 三态数字:没提到 / 显式 null / 有值。
	OptionalInt32 = fp.OptionalInt32
	// OptionalString —— 三态字符串。
	OptionalString = fp.OptionalString
	// OptionalBool —— 三态开关。
	OptionalBool = fp.OptionalBool
	// OptionalStrings —— 三态列表。
	OptionalStrings = fp.OptionalStrings
)
