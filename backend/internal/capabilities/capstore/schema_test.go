// schema_test.go —— pure unit tests (no DB touched) for schema-name derivation + the DROP
// core-safety guard. The assertion that matters most: **no (kind,id) input can ever derive a
// name that is both DROPpable and hits core**, and the guard refuses every name with no
// reserved prefix / that's core / that's empty. A leaky guard → these assertions go red
// (guard-must-fail-on-the-bug).

package capstore //nolint:testpackage // schemaName/assertDroppable are unexported, share pkg

import "testing"

func TestSchemaName_Derivation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		kind Kind
		id   string
		want string
	}{
		{KindConnector, "google-calendar", "connector_google_calendar"}, // '-' sanitized
		{KindConnector, "smtp", "connector_smtp"},
		{KindMCP, "calendar.book", "mcp_calendar_book"}, // '.' sanitized
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
		{KindConnector, ""},    // empty id
		{KindConnector, "---"}, // empty after sanitizing
		{Kind("core"), "x"},    // unknown kind
		{Kind(""), "x"},        // empty kind
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
		"public",             // core
		"pg_catalog",         // core
		"information_schema", // core
		"",                   // empty
		"dialogs",            // where core tables live (no prefix)
		"codes",              // no prefix
		"connector",          // just the prefix word, no '_suffix'
		"mcp",                // same
		"public_",            // doesn't match a reserved prefix
		"xmcp_booker",        // prefix not at the start of the word
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

// TestNoInputProducesCoreDrop —— a fallback: iterate a batch of malicious ids to prove
// schemaName either errors or produces a plugin name that passes the guard — it never
// produces a "DROPpable core name".
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
		return // a refusal is safe
	}
	if derr := assertDroppable(name); derr != nil {
		t.Fatalf("schemaName(%s,%q)=%q slipped past the guard: %v", kind, id, name, derr)
	}
	if coreSchemas[name] {
		t.Fatalf("schemaName(%s,%q) produced CORE schema %q — data-loss risk", kind, id, name)
	}
}
