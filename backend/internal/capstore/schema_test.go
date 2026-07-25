// schema_test.go —— schema 名推导 + DROP 核心安全守卫的纯 UT(不碰 DB)。最要紧的断言:
// **没有任何 (kind,id) 输入能推出一个"可 DROP 且命中核心"的名字**,且守卫会拒绝一切
// 非保留前缀 / 核心 / 空的名字。守卫漏了 → 这些断言变红(guard-must-fail-on-the-bug)。

package capstore //nolint:testpackage // 测未导出守卫(schemaName/assertDroppable),必须同包

import "testing"

func TestSchemaName_Derivation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		kind Kind
		id   string
		want string
	}{
		{KindConnector, "google-calendar", "connector_google_calendar"}, // '-' 净化
		{KindConnector, "smtp", "connector_smtp"},
		{KindMCP, "calendar.book", "mcp_calendar_book"}, // '.' 净化
		{KindMCP, "corpus.retrieval", "mcp_corpus_retrieval"},
	}
	for _, c := range cases {
		got, err := schemaName(c.kind, c.id)
		if err != nil {
			t.Fatalf("schemaName(%s,%q): %v", c.kind, c.id, err)
		}
		if got != c.want {
			t.Fatalf("schemaName(%s,%q) = %q, want %q", c.kind, c.id, got, c.want)
		}
	}
}

func TestSchemaName_RejectsBadInput(t *testing.T) {
	t.Parallel()
	bad := []struct {
		kind Kind
		id   string
	}{
		{KindConnector, ""},    // 空 id
		{KindConnector, "---"}, // 净化后为空
		{Kind("core"), "x"},    // 未知 kind
		{Kind(""), "x"},        // 空 kind
	}
	for _, b := range bad {
		if _, err := schemaName(b.kind, b.id); err == nil {
			t.Fatalf("schemaName(%q,%q) must error, got a name", b.kind, b.id)
		}
	}
}

func TestAssertDroppable_RefusesCoreAndUnprefixed(t *testing.T) {
	t.Parallel()
	refuse := []string{
		"public",             // 核心
		"pg_catalog",         // 核心
		"information_schema", // 核心
		"",                   // 空
		"dialogs",            // 核心表所在(无前缀)
		"codes",              // 无前缀
		"connector",          // 只有前缀词、无 '_后缀'
		"mcp",                // 同上
		"public_",            // 不匹配保留前缀
		"xmcp_booker",        // 前缀不在词首
	}
	for _, name := range refuse {
		if err := assertDroppable(name); err == nil {
			t.Fatalf("assertDroppable(%q) must refuse (core-safety), but allowed the DROP", name)
		}
	}
}

func TestAssertDroppable_AllowsPluginSchemas(t *testing.T) {
	t.Parallel()
	ok := []string{"connector_google_calendar", "mcp_calendar_book", "connector_smtp"}
	for _, name := range ok {
		if err := assertDroppable(name); err != nil {
			t.Fatalf("assertDroppable(%q) must allow plugin schema, got %v", name, err)
		}
	}
}

// TestNoInputProducesCoreDrop —— 兜底:遍历一堆恶意 id,证明 schemaName 要么报错、要么给出
// 一个过得了守卫的 plugin 名 —— 永远不会给出一个"能 DROP 的核心名"。
func TestNoInputProducesCoreDrop(t *testing.T) {
	t.Parallel()
	evil := []string{"public", "../public", "public;drop", "pg_catalog", "", "  ", "..", "PUBLIC"}
	for _, id := range evil {
		assertNeverCoreDrop(t, KindConnector, id)
		assertNeverCoreDrop(t, KindMCP, id)
	}
}

func assertNeverCoreDrop(t *testing.T, kind Kind, id string) {
	t.Helper()
	name, err := schemaName(kind, id)
	if err != nil {
		return // 拒绝 = 安全
	}
	if derr := assertDroppable(name); derr != nil {
		t.Fatalf("schemaName(%s,%q)=%q slipped past the guard: %v", kind, id, name, derr)
	}
	if coreSchemas[name] {
		t.Fatalf("schemaName(%s,%q) produced CORE schema %q — data-loss risk", kind, id, name)
	}
}
