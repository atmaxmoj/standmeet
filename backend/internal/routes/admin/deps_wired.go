// deps_wired.go —— 启动时确认每一组 dep 都真的被接上了。
//
// 机制在 internal/infra/depcheck（面上只留声明和调用）。为什么需要它、以及
// 2026-08-31 漏掉 `EmailChange` 那一行的后果，写在那个包的头上。

package admin

import (
	"reflect"

	"github.com/atmaxmoj/standmeet/internal/infra/depcheck"
)

// AssertDepsWired —— 每一组 dep 至少有一个成员非 nil。装配根在开始服务之前调；
// 失败就不起来（一个装配漏了一条的实例，比一个起不来的实例难查得多）。
func (h *Handlers) AssertDepsWired() error {
	return depcheck.AllWired(reflect.ValueOf(h).Elem())
}
