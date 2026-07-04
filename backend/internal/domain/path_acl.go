// path_acl.go —— 现在只剩 compileGlob：URI glob 编译成 regex，给
// [[role]] / [[role_snapshot]].AllowsCorpus 用。
//
// 旧的 PathACL / PathPermission / AllowsPath / AllowsEntry 在 A.3-IAM-5 删除。
// ACL 现在统一走 RoleSnapshot.AllowsCorpus(uri)，每张 access_code 必挂
// assumed_role_id（NOT NULL）。
//
// Glob 方言：`**` 跨 `/` 递归 (`.*`)，`*` 不跨 `/` (`[^/]*`)，`?` 不跨 `/`
// (`[^/]`)；其他元字符 escape。

package domain

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
