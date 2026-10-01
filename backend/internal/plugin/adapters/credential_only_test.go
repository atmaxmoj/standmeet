package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The owner pastes a bot token and presses Connect. A credential block that declares where its
// token is accepted (transport url + headers) is checked there first: a token the service refuses
// is refused on the card, not discovered later in a container log (sijie, 2026-10-01).

type fakeCredVault struct{ token string }

func (fakeCredVault) Connected(context.Context, string, string) (bool, error) { return true, nil }

func (v fakeCredVault) Credentials(context.Context, string, string) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]string{"token": v.token})
	return b, err
}

// verifyWith — connect a "discord" credential block holding token, against a stand-in Discord.
func verifyWith(t *testing.T, token string) error {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bot good-token" || r.URL.Path != "/me" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	t.Cleanup(srv.Close)
	check := CredentialCheck{
		URL:     srv.URL + "/me",
		Headers: map[string]string{"Authorization": "Bot {token}"},
		Title:   "Discord",
	}
	sup := NewCredentialOnlySupplier("discord", fakeCredVault{token: token}, check, srv.Client())
	v, ok := sup.(Verifier)
	if !ok {
		t.Fatal("a credential block that declares a check must verify on connect")
	}
	return v.Verify(t.Context(), "owner")
}

func TestCredentialCheckAcceptsTheServicesToken(t *testing.T) {
	if err := verifyWith(t, " good-token\n"); err != nil {
		t.Fatalf("a token the service accepts (pasted with stray whitespace) must pass: %v", err)
	}
}

func TestCredentialCheckRefusesWithAPlainSentence(t *testing.T) {
	err := verifyWith(t, "not-a-bot")
	if err == nil || !strings.Contains(err.Error(), "Discord did not accept this token") {
		t.Fatalf("want the owner-facing refusal, got %v", err)
	}
	var fc interface{ FaultCode() string }
	if !errors.As(err, &fc) {
		t.Fatal("the refusal must carry a fault code so the card shows it verbatim")
	}
}

func TestCredentialBlockWithoutCheckStillConnectsOnSave(t *testing.T) {
	none := CredentialCheck{}
	sup := NewCredentialOnlySupplier("telegram", fakeCredVault{}, none, http.DefaultClient)
	if _, ok := sup.(Verifier); ok {
		t.Fatal("no declared check → no connect-time test (saving the credential is the whole act)")
	}
}
