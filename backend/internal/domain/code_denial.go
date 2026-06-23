// code_denial.go —— code 层 ACL 的纯解析（capability-acl-hierarchy.md §3）。
//
// 模型：纯 AND·code-deny。frozen allow = roleGranted \ denied（集合相减）。code 只能
// 从所选 role 授的集合里**减**，不能加（翻不了 role 的 deny、也加不了 role 没有的）。
// 这是整套三层 ACL 的「真值之锚」—— tri-state / override 概念不存在，唯一真值在此。

package domain

import "slices"

// ResolveACL —— 返回 roleGranted 里没被 denied 的项，保留 roleGranted 原顺序
// （确定性，对齐 system_prompt_hash 不变量）。无副作用：不改入参，返回新 slice。
// issue 时对 capability / skill 各跑一遍，结果冻进 RoleSnapshot；下游 gate 读法不变。
func ResolveACL(roleGranted, denied []string) []string {
	out := make([]string, 0, len(roleGranted))
	for _, g := range roleGranted {
		if !slices.Contains(denied, g) {
			out = append(out, g)
		}
	}
	return out
}
