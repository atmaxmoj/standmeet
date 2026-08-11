// corpus_scope_test.go —— ACL 三类里的 corpus 那类：身份读得到什么 + code 收回了什么。
//
// 这是 gate 1 的代数，错一处就是泄露，所以它在这里被逐条钉死：纯减法、顺序无关、code 开不了
// role 没给的。**public 身份那一支也在这里**：它不看 glob，看条目自己的 published（F-D-7）。

package entity_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/stretchr/testify/require"
)

// 这几条 URI 在下面反复出现（每个 case 都要一个"授了的"和一个"被收回的"）；提成常量。
const (
	globWikiAll   = "wiki://**"
	globSubjAll   = "subjectivity://**"
	uriCV         = "subjectivity://cv"
	uriStandpoint = "subjectivity://standpoint"
	globWikiPriv  = "wiki://private/**"
)

// 受邀身份的那些 case 里 published 是**无关**的（owner 是故意把这条授出去的），
// 所以统一传 unpublished —— 让"glob 授权不看发布状态"这件事在每一行上都看得见。
const (
	unpublished = false
	published   = true
)

// allows —— 把「scope + 这一条」读成一行，省得每个断言里都摊开一个 struct literal。
func allows(scope entity.CorpusScope, uri string, isPublished bool) bool {
	return entity.AllowsCorpusEntry(scope, entity.CorpusEntryRef{URI: uri, Published: isPublished})
}

// TestAllowsCorpusEntry_CodeNarrowsRole —— 真实动机：一张 role 授了整个 subjectivity（stances 都要
// 给），但某张码不该看见 record 笔记（CV：真名/学历/雇主）。owner 在这张码上收回 `subjectivity://cv`。
func TestAllowsCorpusEntry_CodeNarrowsRole(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted: []string{globWikiAll, globSubjAll},
		Denied:  []string{uriCV},
	}
	require.False(t, allows(scope, uriCV, unpublished),
		"the code took this one back — it must not be readable")
	require.True(t, allows(scope, uriStandpoint, unpublished),
		"the rest of the grant is untouched")
	require.True(t, allows(scope, "wiki://math/logic", unpublished),
		"other genres are untouched")
}

// TestAllowsCorpusEntry_DenyCannotOpen —— 纯减法的另一半，也是 A.4 的铁律：code 只能减。
// 一条 deny 列表里的 glob 不会因为"被提到了"就变得可读；role 没授的照样不可读。
func TestAllowsCorpusEntry_DenyCannotOpen(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted: []string{globWikiAll},
		Denied:  []string{uriCV},
	}
	require.False(t, allows(scope, uriStandpoint, unpublished),
		"role never granted subjectivity — mentioning a subjectivity glob in DENY opens nothing")
}

// TestAllowsCorpusEntry_OrderIndependent —— A.2 当初 defer corpus 层级收窄，理由是"顺序敏感、
// first-match-wins"。那描述的是 deny 行混进一张 glob 列表的方案。两个独立列表 = 集合交，
// **排列顺序不影响结果** —— 这条测试就是那个理由不成立的证据。
func TestAllowsCorpusEntry_OrderIndependent(t *testing.T) {
	t.Parallel()
	const uri = uriCV
	a := entity.CorpusScope{
		Granted: []string{globSubjAll, globWikiAll},
		Denied:  []string{uriCV, globWikiPriv},
	}
	b := entity.CorpusScope{ // 两个列表都反着写
		Granted: []string{globWikiAll, globSubjAll},
		Denied:  []string{globWikiPriv, uriCV},
	}
	require.Equal(t,
		allows(a, uri, unpublished),
		allows(b, uri, unpublished),
		"reordering either list must not change the verdict — set intersection, not first-match")
	require.False(t, allows(a, uri, unpublished))
}

// TestAllowsCorpusEntry_DenyGlobTakesSubtree —— deny 的单位跟 grant 同一种语言（glob，不是 note id）：
// 一条 `subjectivity://**` 就把整个 genre 从这张码收回，逐条写也行。
func TestAllowsCorpusEntry_DenyGlobTakesSubtree(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted: []string{globWikiAll},
		Denied:  []string{globWikiPriv},
	}
	require.False(t, allows(scope, "wiki://private/salary", unpublished))
	require.False(t, allows(scope, "wiki://private/deep/nested", unpublished))
	require.True(t, allows(scope, "wiki://public/thing", unpublished))
}

// TestAllowsCorpusEntry_EmptyDenyIsInheritance —— 没配 deny = 完全继承 role（向后兼容：既有的码
// 一行 deny 都没有，行为必须逐字不变）。
func TestAllowsCorpusEntry_EmptyDenyIsInheritance(t *testing.T) {
	t.Parallel()
	granted := []string{globWikiAll, globSubjAll}
	for _, denied := range [][]string{nil, {}} {
		scope := entity.CorpusScope{Granted: granted, Denied: denied}
		require.True(t, allows(scope, uriCV, unpublished),
			"no denials → the role's grant stands unchanged")
	}
}

// TestAllowsCorpusEntry_RawStillHardDenied —— raw://** 是硬编码 deny，不因为 grant 写了它就开。
// deny 层不该动摇这条既有的地板。
func TestAllowsCorpusEntry_RawStillHardDenied(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{Granted: []string{"raw://**", globWikiAll}}
	require.False(t, allows(scope, "raw://anything", unpublished),
		"raw is denied to visitors regardless of the grant list")
}

// TestAllowsCorpusEntry_PublicReadsOnlyPublished —— **F-D-7 的代数**。
//
// public 身份（无码访客 + BYOAI）没有正列表：一条读不读得到，看它自己发布没有。
// 以前它带着 `wiki://**`，于是标着 PRIVATE 的笔记照样被读走 —— 那份 glob 是同一件事的
// 第二份数据，而两份数据里错的那一份没人会发现。
func TestAllowsCorpusEntry_PublicReadsOnlyPublished(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{PublishedOnly: true}
	require.True(t, allows(scope, "wiki://open/note", published),
		"the owner published this one — a stranger may read it")
	require.False(t, allows(scope, "wiki://held/back", unpublished),
		"private with no code is unreadable — that is the whole rule")
	require.False(t, allows(scope, "raw://anything", published),
		"raw stays denied on this branch too")
}

// TestAllowsCorpusEntry_PublicIgnoresAStaleGrantList —— 老实例的 role_corpus_uris 里还留着
// 那三条 glob（seed 只在 claim 时跑）。它们**不得**再让 public 读到未发布的东西：
// 判据是身份，不是那张表里剩下什么。
func TestAllowsCorpusEntry_PublicIgnoresAStaleGrantList(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Granted:       []string{globWikiAll, "output://**", "writing://**"},
		PublishedOnly: true,
	}
	require.False(t, allows(scope, "wiki://held/back", unpublished),
		"a leftover wiki://** row must not reopen what the owner never published")
}

// TestAllowsCorpusEntry_PublicStillObeysCodeDenials —— public 身份也走 deny 那一半：
// 自动签发的 application code 挂的就是 public，owner 在那张码上收回的必须仍然收得回来。
func TestAllowsCorpusEntry_PublicStillObeysCodeDenials(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{
		Denied:        []string{globWikiPriv},
		PublishedOnly: true,
	}
	require.True(t, allows(scope, "wiki://open/note", published))
	require.False(t, allows(scope, "wiki://private/pay", published),
		"published, but this code took the subtree back")
}

// TestAllowsCorpusEntry_InvitedReadsUnpublished —— 反方向也要钉住，否则"全都按 published 过"
// 这种偷懒实现也能让上面几条过：**受邀**身份读得到未发布的笔记，那正是发一张码的意义。
func TestAllowsCorpusEntry_InvitedReadsUnpublished(t *testing.T) {
	t.Parallel()
	scope := entity.CorpusScope{Granted: []string{globWikiAll}}
	require.True(t, allows(scope, "wiki://held/back", unpublished),
		"the owner invited this visitor on purpose — publishing is not what gates them")
}
