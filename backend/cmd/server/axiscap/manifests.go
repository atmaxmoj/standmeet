// manifests.go —— 内建能力的声明从哪儿来。
//
// **声明本身不在这儿** —— 它们在 backend/capabilities/<id>/manifest.yaml,跟
// backend/connectors/ 同形:两根插件轴,一样的地址结构。这个文件只是组装根取它们的口子。
//
// 以前这里是五份 Go 字面量(能力的身份、它点了哪些 host op、它在码上占哪个字段、它的配置
// 默认值),二百多行。那是**能力自己的知识写在装配的地方** —— 装配根该只做装配。

package axiscap

import (
	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// BuiltinManifests —— 内建能力的声明,一处读入。注册、facade-parity 的对账、入站收口发单、
// 码上的字段、用量闸,读的都是这一份;谁也不会照着一份过期的副本去核对。
//
// 读不出来 / 解析不了 → **panic**。内建声明是随产品发的资产,不是运行期条件:一份坏掉的
// manifest 意味着这个构建是坏的,让它带着半套能力起来只会把问题推到访客那一侧。
func BuiltinManifests() []mcpplugin.Manifest {
	return builtins
}

// builtins —— 进程内只读一次。
var builtins = mustLoadBuiltins()

func mustLoadBuiltins() []mcpplugin.Manifest {
	out, err := capabilities.Load()
	if err != nil {
		panic(err)
	}
	return out
}
