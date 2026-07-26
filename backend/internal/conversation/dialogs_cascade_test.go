// dialogs_cascade_test.go —— dialog 中间层的删除级联是 schema 不变量。
//
// 层级：conversation → dialog → message（一轮「人问 + AI 答」= 一个 dialog，内容留 messages）。
// 三条必须成立的边界（后端无 DB 测试 harness，UT 全 pure，故把级联当 schema 文本断言，真删除
// 行为由 postgres FK 保证）：
//   - 删 conversation → 其 dialogs 全没（dialogs.conversation_id ON DELETE CASCADE）。
//   - 删 dialog → 其 messages 全没（messages.dialog_id ON DELETE CASCADE）——链不断、无孤儿。
//   - 删 member **不**连带删对话历史（conversations.member_id ON DELETE SET NULL）：member 是
//     session 背后的身份，被清理时对话（含 dialog/message）要留下，只把归属置空。

package conversation_test

import (
	"os"
	"regexp"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDialogCascadeChain(t *testing.T) {
	t.Parallel()
	schema := readSchema(t)

	dialogs := tableBlock(t, schema, "dialogs")
	require.Regexp(t,
		`conversation_id\s+uuid\s+NOT NULL REFERENCES conversations\(id\) ON DELETE CASCADE`,
		dialogs, "delete conversation → dialogs cascade (no orphan dialogs)")

	messages := tableBlock(t, schema, "messages")
	require.Regexp(t,
		`dialog_id\s+uuid\s+NOT NULL REFERENCES dialogs\(id\) ON DELETE CASCADE`,
		messages, "delete dialog → messages cascade (chain unbroken, no orphan messages)")
	require.Regexp(t,
		`conversation_id\s+uuid\s+NOT NULL REFERENCES conversations\(id\) ON DELETE CASCADE`,
		messages, "delete conversation → messages cascade (independent path, also holds)")
}

func TestMemberDeleteKeepsDialogHistory(t *testing.T) {
	t.Parallel()
	conversations := tableBlock(t, readSchema(t), "conversations")
	require.Regexp(t,
		`member_id\s+uuid\s+REFERENCES code_members\(id\) ON DELETE SET NULL`,
		conversations,
		"member delete must SET NULL (keep the conversation + its dialogs/messages), not cascade")
}

func readSchema(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../../db/schema.sql")
	require.NoError(t, err)
	return string(b)
}

func tableBlock(t *testing.T, schema, table string) string {
	t.Helper()
	re := regexp.MustCompile(`(?s)CREATE TABLE ` + table + ` \((.*?)\);`)
	m := re.FindStringSubmatch(schema)
	require.Len(t, m, 2, table+" table not found in schema.sql")
	return m[1]
}
