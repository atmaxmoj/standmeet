// app_state_cascade_test.go — mcp_app_state delete cascade is a schema invariant.
//
// MCP App state hangs off member (the durable identity behind a session). Two boundaries:
//   - session (Redis token) expiry/logout does **not** delete state — state must survive
//     across refreshes, that's the reason it exists; the same member reads it back next visit.
//   - member deleted (code cleanup / owner deregistration / code revocation → code_members
//     cascade) → all its app state must disappear too: no orphans, and no leaking state to
//     whatever future identity reuses that same row.
//
// The backend has no DB test harness (UTs are all pure), so here the cascade is asserted
// as a schema-text invariant: the table must declare ON DELETE CASCADE for both
// code_members and owners. The real delete behavior is guaranteed by the postgres FK.

package repo_test

import (
	"os"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMCPAppStateCascadesWithMemberAndOwner(t *testing.T) {
	t.Parallel()
	schema, err := os.ReadFile("../../../db/schema.sql")
	require.NoError(t, err)
	block := mcpAppStateTableBlock(t, string(schema))

	require.Regexp(t,
		`member_id\s+uuid\s+NOT NULL REFERENCES code_members\(id\) ON DELETE CASCADE`,
		block, "member delete (code cleanup) must cascade app state: no orphans, no leak")
	require.Regexp(t,
		`owner_id\s+uuid\s+NOT NULL REFERENCES owners\(id\) ON DELETE CASCADE`,
		block, "owner delete must cascade app state")
}

func mcpAppStateTableBlock(t *testing.T, schema string) string {
	t.Helper()
	m := regexp.MustCompile(`(?s)CREATE TABLE mcp_app_state \((.*?)\);`).FindStringSubmatch(schema)
	require.Len(t, m, 2, "mcp_app_state table not found in schema.sql")
	return m[1]
}
