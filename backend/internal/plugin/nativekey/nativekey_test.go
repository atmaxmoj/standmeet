// nativekey_test.go — the native key must not leak its value via fmt / logging / JSON / text.
// Only Reveal() returns the real value, at the auth boundary.
package nativekey_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/plugin/nativekey"
)

const secret = "nk_super_secret_value_do_not_leak"

func leaks(s string) bool { return s == secret || s == `"`+secret+`"` }

func TestKey_FmtRedacts(t *testing.T) {
	t.Parallel()
	k := nativekey.Key(secret)
	for _, verb := range []string{"%s", "%v", "%+v", "%#v"} {
		if got := fmt.Sprintf(verb, k); leaks(got) {
			t.Fatalf("fmt %q leaked the value: %q", verb, got)
		}
	}
	if k.String() != "***" {
		t.Fatalf("String() = %q, want ***", k.String())
	}
}

func TestKey_EncodersRedact(t *testing.T) {
	t.Parallel()
	k := nativekey.Key(secret)
	tb, err := k.MarshalText()
	if err != nil || string(tb) != "***" {
		t.Fatalf("MarshalText = %q, err %v; want ***", tb, err)
	}
	jb, err := json.Marshal(struct {
		K nativekey.Key `json:"k"`
	}{k})
	if err != nil || string(jb) != `{"k":"***"}` {
		t.Fatalf("json = %s, err %v; want redacted", jb, err)
	}
}

func TestKey_RevealReturnsValue(t *testing.T) {
	t.Parallel()
	if got := nativekey.Key(secret).Reveal(); got != secret {
		t.Fatalf("Reveal() = %q, want the real value", got)
	}
}
