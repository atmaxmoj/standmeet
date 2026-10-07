package inference

// cred_redact_test.go —— a plaintext AI key never comes out of a credential by printing it.
//
// The refactor ledger (R5, 2026-10-06): the decrypted provider key rode plain structs with no
// redacting String / MarshalJSON, so one `slog` call, a `%+v` in a wrapped error, or a JSON dump
// would write the key into the logs. The connector layer already keeps "credentials never leave
// the vault"; this holds AI keys to the same rule.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/secret"
)

// plantedKey —— a marker, not a key: what must never show up in any rendering.
const plantedKey = "planted-provider-key-marker"

func newKey(s string) secret.String { return secret.New(s) }

func TestTheKeyIsStillThereForTheCall(t *testing.T) {
	t.Parallel()
	c := Cred{Key: newKey(plantedKey)}
	if c.Key.Reveal() != plantedKey {
		t.Fatalf("Reveal() = %q, want the key the provider call needs", c.Key.Reveal())
	}
}

// Every struct in this package that carries a plaintext provider key.
func TestCredentialsNeverPrintTheirKey(t *testing.T) {
	t.Parallel()
	k := newKey(plantedKey)
	noKeyIn(t, "Cred", Cred{Provider: "groq", Key: k, Endpoint: "https://x", Model: "m"})
	noKeyIn(t, "VisitorCred", VisitorCred{Provider: "groq", Key: k})
	noKeyIn(t, "ownerCred", ownerCred{Provider: "groq", Key: k})
	noKeyIn(t, "OwnerKeyView", OwnerKeyView{Provider: "groq", Key: k})
	noKeyIn(t, "credFields", credFields{Provider: "groq", Key: k})
}

// noKeyIn —— every way a value usually reaches a log line: fmt verbs (also by pointer), a wrapped
// error, JSON, and slog with both handlers.
func noKeyIn[T Cred | VisitorCred | ownerCred | OwnerKeyView | credFields](
	t *testing.T, name string, v T,
) {
	t.Helper()
	js, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var text, jsonLog bytes.Buffer
	slog.New(slog.NewTextHandler(&text, nil)).Info("cred", "v", v)
	slog.New(slog.NewJSONHandler(&jsonLog, nil)).Info("cred", "v", v)
	outs := []string{
		fmt.Sprintf("%v", v), fmt.Sprintf("%+v", v), fmt.Sprintf("%#v", v),
		fmt.Sprintf("%+v", &v), fmt.Errorf("wrap: %v", v).Error(),
		string(js), text.String(), jsonLog.String(),
	}
	for _, out := range outs {
		if strings.Contains(out, plantedKey) {
			t.Errorf("%s leaked its key: %s", name, out)
		}
	}
}
