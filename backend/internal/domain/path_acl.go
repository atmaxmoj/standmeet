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
)

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
