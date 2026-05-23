// path_acl.go —— path-glob ACL 评估。设计源自 legacy
// standmeet-server/backend/domain/iam/path_matcher.py +
// standmeet-server/gateway/src/runtime/mcp-tools.ts (isAllowed)。
//
// 规则：
//   - 空 permissions 列表 → 全允许（无 ACL 配置 = open）
//   - 非空时按 order 升序排序、首条匹配 wins；不匹配任何规则 → default deny
//   - Glob 方言：`**` 跨 `/` 递归，`*` 不跨 `/`，`?` 不跨 `/`
//   - 空 path（entry 没设 path）→ 仅当 permissions 为空时允许，否则 deny

package domain

import (
	"regexp"
	"slices"
	"strings"
)

// PathACL —— 评估 path 准入。NewPathACL 排序好顺序、预编译 regex；
// 之后所有方法都是只读。值类型可直接传 (没有 sync 字段)。
type PathACL struct {
	rules []compiledRule
}

type compiledRule struct {
	re     *regexp.Regexp
	action string
}

// NewPathACL —— 按 order asc 排序好规则；预编译 regex。
func NewPathACL(perms []PathPermission) PathACL {
	sorted := slices.Clone(perms)
	slices.SortStableFunc(sorted, func(a, b PathPermission) int { return a.Order - b.Order })
	out := PathACL{rules: make([]compiledRule, 0, len(sorted))}
	for i := range sorted {
		out.rules = append(out.rules, compiledRule{
			re:     compileGlob(sorted[i].PathPattern),
			action: sorted[i].Action,
		})
	}
	return out
}

// AllowsEntry —— 给 wiki/output entry 用：空 path + 空 ACL = 允许 (legacy
// behavior，未配 ACL 全开)；空 path + 非空 ACL = deny (path 没设的 entry 在
// 配了 ACL 的 session 里不可见)；非空 path = AllowsPath(path)。
func (a PathACL) AllowsEntry(path string) bool {
	if len(a.rules) == 0 {
		return true
	}
	if path == "" {
		return false
	}
	return a.AllowsPath(path)
}

// AllowsPath —— 评估具体 path。empty rules → allow；非空时 first-match-wins，
// 默认 deny。
func (a PathACL) AllowsPath(path string) bool {
	if len(a.rules) == 0 {
		return true
	}
	for i := range a.rules {
		if a.rules[i].re.MatchString(path) {
			return a.rules[i].action == "allow"
		}
	}
	return false
}

// compileGlob —— 转换 glob → regex。`**` 跨 `/` (`.*`)，`*` 不跨 `/` (`[^/]*`)，
// `?` 不跨 `/` (`[^/]`)；其他元字符 escape。
func compileGlob(pattern string) *regexp.Regexp {
	const globstarToken = "\x00"
	escaped := regexp.QuoteMeta(pattern)
	escaped = strings.ReplaceAll(escaped, `\*\*`, globstarToken)
	escaped = strings.ReplaceAll(escaped, `\*`, "[^/]*")
	escaped = strings.ReplaceAll(escaped, `\?`, "[^/]")
	escaped = strings.ReplaceAll(escaped, globstarToken, ".*")
	return regexp.MustCompile("^" + escaped + "$")
}
