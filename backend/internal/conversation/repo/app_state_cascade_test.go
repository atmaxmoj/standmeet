// app_state_cascade_test.go —— mcp_app_state 删除级联是 schema 不变量。
//
// MCP App 状态挂在 member（session 背后的耐久身份）上。两条边界：
//   - session（Redis token）过期/登出 **不** 删 state —— state 要跨刷新存活，这是它存在
//     的理由；下次进来同 member 还读得到。
//   - member 被删（code 清理 / owner 注销 / code 撤销 → code_members 级联）→ 其全部 app
//     state 必须跟着没：不留孤儿、不把状态泄漏给复用同一行的将来身份。
//
// 后端无 DB 测试 harness（UT 全 pure），故这里把级联当 schema 文本不变量断言：表必须对
// code_members 与 owners 都声明 ON DELETE CASCADE。真删除行为由 postgres FK 保证。

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
