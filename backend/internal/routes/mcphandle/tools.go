// tools.go —— MCP 工具实现的共享小工具。
//
// Phase E 之前承载 wrapTool / payload / marshalResult 等老 srv.AddTool
// 路径基础设施。E-14 收尾后所有 tool 都走 Capability + adapter
// wrapCapabilityHandler；本文件只剩 defaultListLimit / mcpTimeFmt /
// ptrOrNil 三个被 cap_*.go 复用的小常量 / helper。

package mcphandle

const (
	defaultListLimit = 20
	mcpTimeFmt       = "2006-01-02T15:04:05Z"
)

// ptrOrNil —— domain 类型的 (string, bool) getter (例 Path / ParentID) →
// *string，给 JSON marshal 当 omitempty *string 字段用。
//
// closure 入参形态：caller 传方法引用 `rows[i].Path` 而不是 `rows[i].Path()`，
// 让 helper 内部统一 deref。这样 ptrOrNil 的签名是 (func) 而不是
// (string, bool)，避开 revive flag-parameter 的误判 —— 那条 lint 把 bool
// 参数当 control flag，对 Optional<string> 的 ok 部分是 false positive。
func ptrOrNil(get func() (string, bool)) *string {
	v, ok := get()
	if !ok {
		return nil
	}
	cp := v
	return &cp
}
