package access_test

import (
	"encoding/json"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access"
)

// TestDecodeStringJSON_NeverNil —— F-D-1 root cause. A slice-valued JSONB column can hold the
// JSON literal `null` (not just empty). json.Unmarshal("null", &[]string) SUCCEEDS and leaves
// the slice nil, which re-marshals as JSON `null`. The frontend declares such fields as
// `z.array(z.string()).optional()` — which admits `undefined` but NOT `null` — so one `null`
// row throws the whole `z.array(...)` parse and the entire list renders empty ("No codes yet").
// DecodeStringJSON must therefore ALWAYS return a non-nil slice, so it re-marshals as `[]`.
// Guards both callers: access_codes.ghosts (codes_query.go, live-broken) and connector scopes
// (calendar.go, latent).
func TestDecodeStringJSON_NeverNil(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"json-null-literal": "null", // the F-D-1 trigger
		"empty-bytes":       "",
		"empty-array":       "[]",
	}
	for name, raw := range cases {
		got := access.DecodeStringJSON([]byte(raw))
		if got == nil {
			t.Fatalf("%s: DecodeStringJSON returned a nil slice — re-marshals to JSON `null`, "+
				"which breaks the frontend z.array().optional() and blanks the list", name)
		}
		b, err := json.Marshal(got)
		if err != nil {
			t.Fatalf("%s: marshal: %v", name, err)
		}
		if string(b) != "[]" {
			t.Fatalf("%s: DecodeStringJSON(%q) re-marshals as %s, want []", name, raw, b)
		}
	}
}

func TestDecodeStringJSON_PreservesValues(t *testing.T) {
	t.Parallel()
	got := access.DecodeStringJSON([]byte(`["a","b"]`))
	if len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("DecodeStringJSON lost values: %v", got)
	}
}
