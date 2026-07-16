// corpus_scope_test.go —— ACL 三类里的 corpus 那类：role 授的正列表 + code 收回的。
//
// 这是 gate 1 的代数，错一处就是泄露，所以它在这里被逐条钉死：纯减法、顺序无关、code 开不了
// role 没给的。

package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// 这几条 URI 在下面反复出现（每个 case 都要一个"授了的"和一个"被收回的"）；提成常量。
const (
	globWikiAll   = "wiki://**"
	globSubjAll   = "subjectivity://**"
	uriCV         = "subjectivity://cv"
	uriStandpoint = "subjectivity://standpoint"
	globWikiPriv  = "wiki://private/**"
)

// TestAllowsCorpusScope_CodeNarrowsRole —— 真实动机：一张 role 授了整个 subjectivity（stances 都要
// 给），但某张码不该看见 record 笔记（CV：真名/学历/雇主）。owner 在这张码上收回 `subjectivity://cv`。
func TestAllowsCorpusScope_CodeNarrowsRole(t *testing.T) {
	t.Parallel()
	scope := domain.CorpusScope{
		Granted: []string{globWikiAll, globSubjAll},
		Denied:  []string{uriCV},
	}
	require.False(t, domain.AllowsCorpusScope(scope, uriCV),
		"the code took this one back — it must not be readable")
	require.True(t, domain.AllowsCorpusScope(scope, uriStandpoint),
		"the rest of the grant is untouched")
	require.True(t, domain.AllowsCorpusScope(scope, "wiki://math/logic"),
		"other genres are untouched")
}

// TestAllowsCorpusScope_DenyCannotOpen —— 纯减法的另一半，也是 A.4 的铁律：code 只能减。
// 一条 deny 列表里的 glob 不会因为"被提到了"就变得可读；role 没授的照样不可读。
func TestAllowsCorpusScope_DenyCannotOpen(t *testing.T) {
	t.Parallel()
	scope := domain.CorpusScope{
		Granted: []string{globWikiAll},
		Denied:  []string{uriCV},
	}
	require.False(t, domain.AllowsCorpusScope(scope, uriStandpoint),
		"role never granted subjectivity — mentioning a subjectivity glob in DENY opens nothing")
}

// TestAllowsCorpusScope_OrderIndependent —— A.2 当初 defer corpus 层级收窄，理由是"顺序敏感、
// first-match-wins"。那描述的是 deny 行混进一张 glob 列表的方案。两个独立列表 = 集合交，
// **排列顺序不影响结果** —— 这条测试就是那个理由不成立的证据。
func TestAllowsCorpusScope_OrderIndependent(t *testing.T) {
	t.Parallel()
	const uri = uriCV
	a := domain.CorpusScope{
		Granted: []string{globSubjAll, globWikiAll},
		Denied:  []string{uriCV, globWikiPriv},
	}
	b := domain.CorpusScope{ // 两个列表都反着写
		Granted: []string{globWikiAll, globSubjAll},
		Denied:  []string{globWikiPriv, uriCV},
	}
	require.Equal(t, domain.AllowsCorpusScope(a, uri), domain.AllowsCorpusScope(b, uri),
		"reordering either list must not change the verdict — set intersection, not first-match")
	require.False(t, domain.AllowsCorpusScope(a, uri))
}

// TestAllowsCorpusScope_DenyGlobTakesSubtree —— deny 的单位跟 grant 同一种语言（glob，不是 note id）：
// 一条 `subjectivity://**` 就把整个 genre 从这张码收回，逐条写也行。
func TestAllowsCorpusScope_DenyGlobTakesSubtree(t *testing.T) {
	t.Parallel()
	scope := domain.CorpusScope{
		Granted: []string{globWikiAll},
		Denied:  []string{globWikiPriv},
	}
	require.False(t, domain.AllowsCorpusScope(scope, "wiki://private/salary"))
	require.False(t, domain.AllowsCorpusScope(scope, "wiki://private/deep/nested"))
	require.True(t, domain.AllowsCorpusScope(scope, "wiki://public/thing"))
}

// TestAllowsCorpusScope_EmptyDenyIsInheritance —— 没配 deny = 完全继承 role（向后兼容：既有的码
// 一行 deny 都没有，行为必须逐字不变）。
func TestAllowsCorpusScope_EmptyDenyIsInheritance(t *testing.T) {
	t.Parallel()
	granted := []string{globWikiAll, globSubjAll}
	for _, denied := range [][]string{nil, {}} {
		scope := domain.CorpusScope{Granted: granted, Denied: denied}
		require.True(t, domain.AllowsCorpusScope(scope, uriCV),
			"no denials → the role's grant stands unchanged")
	}
}

// TestAllowsCorpusScope_RawStillHardDenied —— raw://** 是硬编码 deny，不因为 grant 写了它就开。
// deny 层不该动摇这条既有的地板。
func TestAllowsCorpusScope_RawStillHardDenied(t *testing.T) {
	t.Parallel()
	scope := domain.CorpusScope{Granted: []string{"raw://**", globWikiAll}}
	require.False(t, domain.AllowsCorpusScope(scope, "raw://anything"),
		"raw is denied to visitors regardless of the grant list")
}
