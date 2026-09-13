// default_test.go — defaultOf must return a JSON LITERAL (Field.Value/Default are documented as
// such, and toConfigOut wraps them as json.RawMessage). A bare string default (YAML `default:
// hello`) was returned raw as `hello`, which is not valid JSON: the panel's config read then failed
// to marshal (500), and a block reading an un-overridden string-default value got invalid JSON.

package blockconfig //nolint:testpackage // white-box: defaultOf is unexported

import (
	"encoding/json"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/plugin"
)

func TestDefaultOf_ReturnsValidJSONLiteral(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, typ, decl, want string
	}{
		{"string default", plugin.ConfigTypeString, "hello", `"hello"`},
		{"time default", plugin.ConfigTypeTime, "10:00", `"10:00"`},
		{"int default", plugin.ConfigTypeInt, "5", "5"},
		{"bool default", plugin.ConfigTypeBool, "true", "true"},
		{"string-list default", plugin.ConfigTypeStringList, `["a","b"]`, `["a","b"]`},
		{"no default", plugin.ConfigTypeString, "", "null"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := defaultOf(&plugin.ConfigField{Type: c.typ, Default: c.decl})
			assertLiteral(t, c.typ, c.decl, got, c.want)
		})
	}
}

func assertLiteral(t *testing.T, typ, decl, got, want string) {
	t.Helper()
	if !json.Valid([]byte(got)) {
		t.Fatalf("defaultOf(%s=%q) = %q, not valid JSON", typ, decl, got)
	}
	if got != want {
		t.Fatalf("defaultOf(%s=%q) = %q, want %q", typ, decl, got, want)
	}
}
