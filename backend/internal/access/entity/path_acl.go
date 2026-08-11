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
// rawURIPrefix —— raw 永远不进访客检索。两条准入分支都要否决它，所以它是一个常量，
// 不是两处各写一遍的字面量。
const rawURIPrefix = "raw://"

// MatchesAnyCorpusGlob —— positive-list corpus ACL rule in one place: raw://** is
// always denied; otherwise the URI must match at least one granted glob. Empty patterns
// → deny all (A.3-IAM-5).
func MatchesAnyCorpusGlob(patterns []string, uri string) bool {
	if strings.HasPrefix(uri, rawURIPrefix) {
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
// json tag 是**过线契约**：这个 scope 会整块序列化递给沙箱里的检索插件，再原样回到宿主。
type CorpusScope struct {
	Granted []string `json:"granted"`
	Denied  []string `json:"denied"`
	// PublishedOnly —— 这个身份读到的就是 **owner 发布过的那些**，由每条笔记自己的
	// `published` 开关决定（owner 在 /admin/wiki 上翻的那一个）。
	//
	// 它**不是**一份"公开清单"。builtin `public` 身份（未受邀访客 + BYOAI）以前带着
	// `wiki://** output://** writing://**` 三条 glob —— 那是把"谁能读什么"这件事**存了
	// 第二份**：条目上标着 PRIVATE，而这份清单说"全部"，两边谁也不知道对方在。F-D-7
	// 就是这么发生的：没有码的陌生人读到了 573 条标着 PRIVATE 的 wiki。
	//
	// 所以这里存的是**一个 bit：去问条目**，而不是一份被复述出来的范围。
	PublishedOnly bool `json:"published_only"`
}

// CorpusEntryRef —— 被判定的那一条：它的 URI，和它自己的公开开关。
//
// 做成一个值而不是多一个 bool 参数：`published` 不是模式开关，它是**这条笔记的属性**，
// 跟 URI 一样属于"被判的东西"那一侧。调用处读起来也就成了「这个 scope 能不能读这条」。
type CorpusEntryRef struct {
	URI       string
	Published bool
}

// ReachesAnything —— 这个身份**够得着语料吗**（能力闸用：够不着就别把检索工具挂上）。
//
// 判据必须问 scope 自己。以前闸门问的是「正列表空不空」，而 public 身份的范围根本不是列表 ——
// 于是它一改成 published-only，检索能力对每一个无码访客整个关掉，表现成"搜什么都没有"。
// 一个规则新增一条成立方式，判定它的地方就得跟着知道；把判定放在规则身上，它就不会不知道。
func (s CorpusScope) ReachesAnything() bool {
	return s.PublishedOnly || len(s.Granted) > 0
}

// AllowsCorpusEntry —— corpus 准入的唯一真值（ACL 三层里的 corpus 那类）：
//
//	readable(entry) = 这个身份读得到它  AND  不命中本码的任一 deny
//
// 「读得到」有两种来源，取决于身份：
//   - **受邀身份**（owner 指定的 role）：命中 role 授的任一 glob。
//   - **public 身份**（未受邀 + BYOAI）：`PublishedOnly` —— 看**这条笔记自己**发布没有。
//     私有的没有码就读不到，而"私有"只有条目上那一个数据说了算。
//
// `entry.Published` 必须由 caller 从那一行上取来。它是必填而不是可选项：编译器因此逼每一个
// 读取面回答"这条发布了吗"，漏一个不会静默放行 —— 只会编不过。
//
// **纯减法**：deny 只能让可读的更少，code 开不了 role 没给的 —— 跟 capability/skill 的 deny 集同构，
// 也跟 A.4 定的"纯 AND、code 只能 deny"一致。
//
// **顺序无关**：deny 和 grant 分两遍算，不是一张混排列表里 first-match-wins。A.2 当初 defer corpus
// 层级收窄，理由正是"顺序敏感、first-match-wins"；那描述的是 deny 行混进 glob 列表的方案（owner
// 也明确 reject 了它）。分开两个列表 = 集合交，没有顺序可言，所以那条顾虑在这里不成立。
func AllowsCorpusEntry(scope CorpusScope, entry CorpusEntryRef) bool {
	if !grantsCorpusEntry(scope, entry) {
		return false
	}
	return !MatchesAnyCorpusGlob(scope.Denied, entry.URI)
}

// grantsCorpusEntry —— 准入的"正"那一半。raw 永远不可读这条规则在
// MatchesAnyCorpusGlob 里，published 那一支也要走它，所以两支都经过同一个否决。
func grantsCorpusEntry(scope CorpusScope, entry CorpusEntryRef) bool {
	if scope.PublishedOnly {
		return entry.Published && !strings.HasPrefix(entry.URI, rawURIPrefix)
	}
	return MatchesAnyCorpusGlob(scope.Granted, entry.URI)
}
