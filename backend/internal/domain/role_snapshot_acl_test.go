// role_snapshot_acl_test.go —— §A 真值表（capability-acl-hierarchy-tests.md）。
//
// 三层 ACL 的 frozen 部分（role ∧ ¬code_deny）落在 RoleSnapshot.AllowsCapability —
// mcpAppGranted 直接委托它。穷尽 baseGrant(role-granted / ACL=always) × code deny，
// 锁住「code 只能减、连 always 能力也能被 deny 挡」。纯 domain 单测（项目里少数走单测
// 的纯判定逻辑，是整套 ACL 的真值之锚）。
package domain_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func TestRoleSnapshot_AllowsCapability(t *testing.T) {
	t.Parallel()
	const target = "calendar.book"
	cases := []struct {
		name    string
		allowed []string // role 授的 tool（含 target = role-granted）
		denied  []string // code deny 的 capability（含 target = denied）
		always  bool     // 该能力 ACL=always?
		want    bool
	}{
		{"role_grant_no_deny", []string{target}, nil, false, true},            // 继承
		{"role_grant_deny", []string{target}, []string{target}, false, false}, // code 撤销
		{"no_grant_no_deny", nil, nil, false, false},                          // 未授
		{"deny_noop_when_ungranted", nil, []string{target}, false, false},     // 幂等 noop
		{"always_no_deny", nil, nil, true, true},                              // ACL=always 恒暴露
		{"always_deny_beats_always", nil, []string{target}, true, false},      // deny 盖过 always
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			snap := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
				AllowedTools: tc.allowed, DeniedCapabilities: tc.denied,
			})
			require.Equal(t, tc.want, snap.AllowsCapability(target, tc.always))
		})
	}
}

// TestRoleSnapshot_AllowsCapability_FrozenThroughWire —— deny 集随 RoleSnapshot 冻结
// 进 session_data（JSON wire）后仍生效（marshal→unmarshal round-trip 不丢）。
func TestRoleSnapshot_AllowsCapability_FrozenThroughWire(t *testing.T) {
	t.Parallel()
	const target = "corpus.retrieval"
	orig := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{
		DeniedCapabilities: []string{target},
	})
	blob, err := orig.MarshalJSON()
	require.NoError(t, err)
	var restored domain.RoleSnapshot
	require.NoError(t, restored.UnmarshalJSON(blob))
	// always 能力被 deny → 解冻后仍挡得住。
	require.False(t, restored.AllowsCapability(target, true))
}
