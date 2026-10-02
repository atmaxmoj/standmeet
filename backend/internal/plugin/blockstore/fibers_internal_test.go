package blockstore

import (
	"strings"
	"testing"
)

const (
	testOwnerFiber = "root_6f1c2a90-1111-2222-3333-444455556666"
	testBundle     = "b_6f1c2a90-1111-2222-3333-444455556666"
	pgNameLimit    = 63
	fitsExactly    = pgNameLimit - len("mcp_")
)

func mustSchema(t *testing.T, fiber, block string) string {
	t.Helper()
	name, err := schemaName(KindMCP, FiberSchemaID(fiber, block))
	if err != nil {
		t.Fatalf("schema for %q/%q: %v", fiber, block, err)
	}
	return name
}

// TestFiberSchemaID — one schema per fiber of a block; no fiber keeps the block's legacy schema.
func TestFiberSchemaID(t *testing.T) {
	t.Parallel()
	cases := []struct{ fiber, want string }{
		{"", "mcp_calendar_book"},
		{testBundle, "mcp_b_6f1c2a90_1111_2222_3333_444455556666_calendar_book"},
		{testOwnerFiber, "mcp_root_6f1c2a90_1111_2222_3333_444455556666_calendar_book"},
	}
	for _, c := range cases {
		if got := mustSchema(t, c.fiber, "calendar.book"); got != c.want {
			t.Errorf("fiber %q → %q, want %q", c.fiber, got, c.want)
		}
	}
	if mustSchema(t, "b_a", "calendar.book") == mustSchema(t, "b_b", "calendar.book") {
		t.Fatal("two fibers share one schema")
	}
}

// TestSchemaName_OverlongNamesStayDistinct — Postgres truncates identifiers past 63 bytes, which
// would fold two long fiber names into one schema. A long name is shortened with a hash of the
// whole: it fits, it is stable, and two names that share their first 63 bytes stay apart.
func TestSchemaName_OverlongNamesStayDistinct(t *testing.T) {
	t.Parallel()
	a := mustSchema(t, testOwnerFiber, "dataloss-int-fixture-a")
	b := mustSchema(t, testOwnerFiber, "dataloss-int-fixture-b")
	if len(a) > pgNameLimit || len(b) > pgNameLimit {
		t.Fatalf("names over %d bytes: %q, %q", pgNameLimit, a, b)
	}
	if a == b {
		t.Fatalf("two long names folded into one schema %q", a)
	}
	if again := mustSchema(t, testOwnerFiber, "dataloss-int-fixture-a"); again != a {
		t.Fatalf("not stable: %q then %q", a, again)
	}
}

// TestSchemaName_FittingNameUnchanged — a name at the limit is used as is.
func TestSchemaName_FittingNameUnchanged(t *testing.T) {
	t.Parallel()
	id := strings.Repeat("x", fitsExactly)
	if got := mustSchema(t, "", id); got != "mcp_"+id {
		t.Fatalf("a %d-byte name was changed: %q", pgNameLimit, got)
	}
}
