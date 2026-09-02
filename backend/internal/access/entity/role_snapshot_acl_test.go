// role_snapshot_acl_test.go — §A truth table (capability-acl-hierarchy-tests.md).
//
// The frozen part of the three-tier ACL (role AND NOT code_deny) lives in
// entity.RoleSnapshot.AllowsCapability — mcpAppGranted delegates to it directly. This
// exhausts baseGrant (role-granted / ACL=always) x code deny, pinning down "a code can only
// subtract, and even an always capability can be blocked by a deny". A pure domain unit
// test (one of the few pure decision-logic units in the project that runs as a unit test —
// it anchors the truth of the whole ACL).
package entity_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/stretchr/testify/require"
)

func TestRoleSnapshot_AllowsCapability(t *testing.T) {
	t.Parallel()
	const target = "calendar.book"
	cases := []struct {
		name    string
		allowed []string // tools the role grants (contains target = role-granted)
		denied  []string // capabilities the code denies (contains target = denied)
		always  bool     // is this capability's ACL=always?
		want    bool
	}{
		{"role_grant_no_deny", []string{target}, nil, false, true},            // inherited
		{"role_grant_deny", []string{target}, []string{target}, false, false}, // code revoked it
		{"no_grant_no_deny", nil, nil, false, false},                          // never granted
		{"deny_noop_when_ungranted", nil, []string{target}, false, false},     // idempotent noop
		{"always_no_deny", nil, nil, true, true},                              // ACL=always shows
		{"always_deny_beats_always", nil, []string{target}, true, false},      // deny beats always
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			snap := entity.NewRoleSnapshot(&entity.RoleSnapshotInit{
				AllowedTools: tc.allowed, DeniedCapabilities: tc.denied,
			})
			require.Equal(t, tc.want, snap.AllowsCapability(target, tc.always))
		})
	}
}

// TestRoleSnapshot_AllowsCapability_FrozenThroughWire —— the deny set still takes effect
// after entity.RoleSnapshot is frozen into session_data (JSON wire) (a marshal->unmarshal
// round-trip does not lose it).
func TestRoleSnapshot_AllowsCapability_FrozenThroughWire(t *testing.T) {
	t.Parallel()
	const target = "corpus.retrieval"
	orig := entity.NewRoleSnapshot(&entity.RoleSnapshotInit{
		DeniedCapabilities: []string{target},
	})
	blob, err := orig.MarshalJSON()
	require.NoError(t, err)
	var restored entity.RoleSnapshot
	require.NoError(t, restored.UnmarshalJSON(blob))
	// An always capability under deny -> still blocked after unfreezing.
	require.False(t, restored.AllowsCapability(target, true))
}
