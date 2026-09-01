// Package depcheck —— 启动时确认一份**手抄的依赖表**没有漏行。
//
// 装配根到路由层之间常常是一份逐字段的赋值表（`Foo: deps.Admin.Foo,` × N）。
// 漏抄一行不会有任何东西报错：编译过、lint 过、启动过，直到某个用户走到那条路上，
// 那一组 dep 是 nil，**空指针 panic**。而 panic 出来的 500 往往被上层归成一类错误，
// 界面对用户说的是一句完全无关的解释（"这个链接无效"），他照着那句话做，永远走不出去。
//
// 2026-08-31 的确认改邮箱就是这样：`EmailChange` 少了一行
// （[[move-the-capability-move-its-edges]]）。
//
// **为什么反射，而不是再写一份检查清单**：清单就是刚才漏掉的那种东西 ——
// 一个需要人记得更新的表。反射看的是结构本身，加新 dep 的人什么都不用做
// （[[structure-means-no-responsibility-class]]）。
//
// 它住在 infra 而不是路由层：路由是"面"，面上只留一句调用；而这套机制跟任何一条路
// 都无关，任何一份手抄的依赖表都能用它。
//
// 入参是 `reflect.Value` 而不是 `any`：`any` 在这个仓库里是禁用的，而这里本来
// 就要反射 —— 让调用方把 `reflect.ValueOf(x).Elem()` 写出来，也把"这是反射"说在明处。
package depcheck

import (
	"fmt"
	"reflect"
	"strings"
)

// AllWired —— rv 的每一组 dep 至少有一个成员非 nil。传结构体（不是指针）。
//
// 判据是"全 nil"而不是"有 nil"：有些 dep 结构体本来就有可选成员，
// 而**一个可空成员都没被赋值**只可能是漏行 —— 没有任何合法装配会留下这种形状。
func AllWired(rv reflect.Value) error {
	if rv.Kind() != reflect.Struct {
		return fmt.Errorf("depcheck: want a struct, got %s", rv.Kind())
	}
	unwired := unwiredFields(rv)
	if len(unwired) == 0 {
		return nil
	}
	return fmt.Errorf("deps never wired: %s — add the missing line(s) where this struct is built",
		strings.Join(unwired, ", "))
}

func unwiredFields(rv reflect.Value) []string {
	var out []string
	t := rv.Type()
	for i := range rv.NumField() {
		if AllNilMembers(rv.Field(i)) {
			out = append(out, t.Field(i).Name)
		}
	}
	return out
}

// AllNilMembers —— 这是一组 dep，而它每个可空成员都是 nil。
// 不是结构体、或者一个可空成员都没有的，都返回 false。
func AllNilMembers(f reflect.Value) bool {
	if f.Kind() != reflect.Struct {
		return false
	}
	nilable := 0
	for _, m := range f.Fields() {
		if !isNilable(m.Kind()) {
			continue
		}
		nilable++
		if !m.IsNil() {
			return false
		}
	}
	return nilable > 0
}

func isNilable(k reflect.Kind) bool {
	return k == reflect.Pointer || k == reflect.Interface || k == reflect.Func || k == reflect.Map
}
