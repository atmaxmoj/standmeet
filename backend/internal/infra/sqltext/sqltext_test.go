package sqltext_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/sqltext"
)

type formatCase struct {
	name, tmpl, want string
	names            []string
}

var formatCases = []formatCase{
	{"one name", "DROP SCHEMA %s", `DROP SCHEMA "mcp_a"`, []string{"mcp_a"}},
	{"indexed twice", "%[1]s.t WHERE %[1]s.t.x", `"s".t WHERE "s".t.x`, []string{"s"}},
	{"two in order", "FROM %s TO %s", `FROM "a" TO "b"`, []string{"a", "b"}},
	{"percent stays", "LIKE $1 || '%%'", "LIKE $1 || '%'", []string{}},
	{
		"a quote stays inside the name", "LISTEN %s", `LISTEN "x""; DROP TABLE t; --"`,
		[]string{`x"; DROP TABLE t; --`},
	},
	{"a verb inside a name is not expanded", "%s %s", `"a%sb" "c"`, []string{"a%sb", "c"}},
	{"missing name fails loudly", "DROP SCHEMA %s", "DROP SCHEMA %!", []string{}},
	{"malformed verb fails loudly", "x %d", "x %!d", []string{}},
}

func TestFormat(t *testing.T) {
	t.Parallel()
	for _, tc := range formatCases {
		if got := sqltext.Format(tc.tmpl, tc.names...); got != tc.want {
			t.Errorf("%s: Format(%q) = %q, want %q", tc.name, tc.tmpl, got, tc.want)
		}
	}
}
