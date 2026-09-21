// default_test.go — DefaultOf must return a JSON LITERAL (ConfigField.Default is wrapped as
// json.RawMessage by every reader). A bare string default (YAML `default: hello`) returned raw as
// `hello` is not valid JSON: the config-store read then failed to marshal (500), and the eval
// mini-host read the booker's un-overridden string/time default as invalid JSON — the calendar
// then looked unavailable and no booking was made.

package plugin_test

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
			got := plugin.DefaultOf(&plugin.ConfigField{Type: c.typ, Default: c.decl})
			assertLiteral(t, c.typ, c.decl, got, c.want)
		})
	}
}

func assertLiteral(t *testing.T, typ, decl, got, want string) {
	t.Helper()
	if !json.Valid([]byte(got)) {
		t.Fatalf("DefaultOf(%s=%q) = %q, not valid JSON", typ, decl, got)
	}
	if got != want {
		t.Fatalf("DefaultOf(%s=%q) = %q, want %q", typ, decl, got, want)
	}
}
