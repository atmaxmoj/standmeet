// code_denial_test.go —— §A 真值表（设计 capability-acl-hierarchy-tests.md）。
//
// 整套 ACL 的「真值之锚」：纯函数 ResolveACL(roleGranted, denied) = roleGranted \ denied。
// 模型是纯 AND·code-deny（A.4 落定）—— code 只能从 role 授的里减，没有 allow 态。
// 穷尽 role ∈ {Y,N} × code ∈ {unset, deny} = 4 行 + determinism（对齐
// system_prompt_hash 不变量）。这是项目里少数走 domain 单测的纯解析逻辑（其余 e2e）。
package domain_test

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	capBook      = "calendar.book"
	capSummarize = "summarize"
	capRetrieval = "corpus.retrieval"
	capAsk       = "ask_visitor"
)

// TestResolveACL_TruthTable —— 一个目标 cap 的命运，按 (role 授? × code deny?) 4 行。
// 判据 = 该 target 在不在 ResolveACL 结果里（exposed）。零 if：role/denied 直接在表里给。
func TestResolveACL_TruthTable(t *testing.T) {
	t.Parallel()
	const target = capBook
	cases := []struct {
		name        string
		role        []string // role 授的集合（含 target = 授）
		denied      []string // code deny 的集合（含 target = deny）
		wantExposed bool
	}{
		{"A1_grant_no_deny", []string{target}, nil, true},            // 继承
		{"A2_grant_deny", []string{target}, []string{target}, false}, // code 撤销
		{"A3_no_grant_no_deny", nil, nil, false},                     // 继承未授
		{"A4_no_grant_deny", nil, []string{target}, false},           // 幂等 noop
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := domain.ResolveACL(tc.role, tc.denied)
			require.Equal(t, tc.wantExposed, slices.Contains(got, target))
		})
	}
}

// TestResolveACL_PreservesRoleOrderMinusDenied —— 多元素：结果保留 roleGranted 顺序，
// 只挖掉被 denied 的（集合相减语义，不是过滤后重排）。
func TestResolveACL_PreservesRoleOrderMinusDenied(t *testing.T) {
	t.Parallel()
	role := []string{capBook, capSummarize, capRetrieval, capAsk}
	denied := []string{capSummarize, capAsk}
	require.Equal(t,
		[]string{capBook, capRetrieval},
		domain.ResolveACL(role, denied))
}

// TestResolveACL_Deterministic —— 同输入跑 3 次结果一字不差（防 map iter 抖动，
// 对齐 system_prompt_hash 不变量：同 role+denial → 同 frozen → 同 hash）。
func TestResolveACL_Deterministic(t *testing.T) {
	t.Parallel()
	role := []string{capBook, capSummarize, capRetrieval}
	denied := []string{capSummarize}
	first := domain.ResolveACL(role, denied)
	for range 3 {
		require.Equal(t, first, domain.ResolveACL(role, denied))
	}
}

// TestResolveACL_NeverMutatesInputs —— 相减不就地改 roleGranted / denied（冻结前
// 的合并必须无副作用，否则会污染调用方持有的 role grant 集）。
func TestResolveACL_NeverMutatesInputs(t *testing.T) {
	t.Parallel()
	role := []string{capBook, capSummarize}
	denied := []string{capSummarize}
	_ = domain.ResolveACL(role, denied)
	require.Equal(t, []string{capBook, capSummarize}, role)
	require.Equal(t, []string{capSummarize}, denied)
}
