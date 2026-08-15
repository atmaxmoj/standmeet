// visitor_tools.go —— manifest 声明的访客工具名，跟真相对账的判定。
//
// 判定住在这儿（声明本身住的地方），不在装配那一侧：装配那一侧只该拿到结论然后记一句日志。

package mcpplugin

// ToolDrift —— 声明跟真相差在哪。Drifted=false 表示不必声张 —— 要么这个能力压根没声明
// （第三方插件的默认，「拨号前查不到它」是允许的），要么两边一致。
type ToolDrift struct {
	// DeclaredButAbsent —— 声明里有、沙箱没给。
	DeclaredButAbsent []string
	// OfferedButUndeclared —— 沙箱给了、声明里没有。
	OfferedButUndeclared []string
	Drifted              bool
}

// VisitorToolDrift —— 拿真相对一遍声明。顺序无关：两份都是集合，谁先谁后不是事实的一部分。
func VisitorToolDrift(m *Manifest, actual []string) ToolDrift {
	if len(m.VisitorTools) == 0 {
		return ToolDrift{DeclaredButAbsent: []string{}, OfferedButUndeclared: []string{}}
	}
	missing := notIn(m.VisitorTools, actual)
	extra := notIn(actual, m.VisitorTools)
	return ToolDrift{
		DeclaredButAbsent: missing, OfferedButUndeclared: extra,
		Drifted: len(missing) > 0 || len(extra) > 0,
	}
}

// notIn —— names 里 other 没有的那些。
func notIn(names, other []string) []string {
	have := make(map[string]struct{}, len(other))
	for _, n := range other {
		have[n] = struct{}{}
	}
	out := []string{}
	for _, n := range names {
		if _, ok := have[n]; !ok {
			out = append(out, n)
		}
	}
	return out
}
