// dialogs_cascade_test.go — the dialog middle layer's delete cascade is a schema invariant.
//
// Hierarchy: conversation → dialog → message (one "person asks + AI answers" turn = one
// dialog, content lives in messages). Three boundaries that must hold (the backend has no
// DB test harness, UTs are all pure, so the cascade is asserted as schema text; the real
// delete behavior is guaranteed by the postgres FK):
//   - delete conversation → all its dialogs gone (dialogs.conversation_id ON DELETE CASCADE).
//   - delete dialog → all its messages gone (messages.dialog_id ON DELETE CASCADE) — chain
//     unbroken, no orphans.
//   - delete member does **not** delete conversation history along with it
//     (conversations.member_id ON DELETE SET NULL): member is the identity behind a
//     session; when it's cleaned up the conversation (including dialog/message) must
//     stay, only its ownership gets nulled out.

package repo_test

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
	b, err := os.ReadFile("../../../db/schema.sql")
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
