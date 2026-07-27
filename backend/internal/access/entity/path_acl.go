// path_acl.go —— 现在只剩 compileGlob：URI glob 编译成 regex，给
// [[role]] / [[role_snapshot]].AllowsCorpus 用。
//
// 旧的 PathACL / PathPermission / AllowsPath / AllowsEntry 在 A.3-IAM-5 删除。
// ACL 现在统一走 RoleSnapshot.AllowsCorpus(uri)，每张 access_code 必挂
// assumed_role_id（NOT NULL）。
//
// Glob 方言：`**` 跨 `/` 递归 (`.*`)，`*` 不跨 `/` (`[^/]*`)，`?` 不跨 `/`
// (`[^/]`)；其他元字符 escape。

package entity

import (
	"regexp"
	"strings"
	"sync"
)

// globRegexCache —— pattern → 编译好的 regex。ACL 是 corpus 读的热路径(每次读 × 每条 glob),
// 之前每次都 regexp.MustCompile 重编。glob 集合小且稳定(role 的 granted globs),缓存一次即可。
var globRegexCache sync.Map // string → *regexp.Regexp

// MatchesAnyCorpusGlob —— positive-list corpus ACL rule in one place: raw://** is
// always denied; otherwise the URI must match at least one granted glob. Empty patterns
// → deny all (A.3-IAM-5). RoleSnapshot.AllowsCorpus delegates here, and the slim
// CorpusLister (#157) calls it directly with the role's granted globs — so search/read/
// list and snapshot ACL can never diverge.
func MatchesAnyCorpusGlob(patterns []string, uri string) bool {
	if strings.HasPrefix(uri, "raw://") {
		return false
	}
	for _, pattern := range patterns {
		if compileGlob(pattern).MatchString(uri) {
			return true
		}
	}
	return false
}

// compileGlob —— pattern → regex，带缓存(热路径避免重编)。
func compileGlob(pattern string) *regexp.Regexp {
	if cached, ok := globRegexCache.Load(pattern); ok {
		if re, isRE := cached.(*regexp.Regexp); isRE {
			return re
		}
	}
	re := buildGlobRegex(pattern)
	globRegexCache.Store(pattern, re)
	return re
}

// buildGlobRegex —— 转换 glob → regex。`**` 跨 `/` (`.*`)，`*` 不跨 `/` (`[^/]*`)，
// `?` 不跨 `/` (`[^/]`)；其他元字符 escape。
func buildGlobRegex(pattern string) *regexp.Regexp {
	const globstarToken = "\x00"
	escaped := regexp.QuoteMeta(pattern)
	escaped = strings.ReplaceAll(escaped, `\*\*`, globstarToken)
	escaped = strings.ReplaceAll(escaped, `\*`, "[^/]*")
	escaped = strings.ReplaceAll(escaped, `\?`, "[^/]")
	escaped = strings.ReplaceAll(escaped, globstarToken, ".*")
	return regexp.MustCompile("^" + escaped + "$")
}

// CorpusScope —— 一个 visitor session 的 corpus 准入范围：role 授的正列表 + 这张 code 收回的。
// 两者正交而非相减：glob 的减法删不掉列表项（`subjectivity://cv` 减不掉 `subjectivity://**`），
// 只能在匹配时判。
type CorpusScope struct {
	Granted []string
	Denied  []string
}

// AllowsCorpusScope —— corpus 准入的唯一真值（ACL 三层里的 corpus 那类）：
//
//	readable(uri) = 命中 role 的任一 grant  AND  不命中本码的任一 deny
//
// **纯减法**：deny 只能让可读的更少，code 开不了 role 没给的 —— 跟 capability/skill 的 deny 集同构，
// 也跟 A.4 定的"纯 AND、code 只能 deny"一致。
//
// **顺序无关**：deny 和 grant 分两遍算，不是一张混排列表里 first-match-wins。A.2 当初 defer corpus
// 层级收窄，理由正是"顺序敏感、first-match-wins"；那描述的是 deny 行混进 glob 列表的方案（owner
// 也明确 reject 了它）。分开两个列表 = 集合交，没有顺序可言，所以那条顾虑在这里不成立。
func AllowsCorpusScope(scope CorpusScope, uri string) bool {
	if !MatchesAnyCorpusGlob(scope.Granted, uri) {
		return false
	}
	return !MatchesAnyCorpusGlob(scope.Denied, uri)
}
