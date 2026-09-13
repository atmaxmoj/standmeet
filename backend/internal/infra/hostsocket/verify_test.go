package hostsocket

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

// TestDispatchNativeKeyVerification — the reach-back is a keyed channel (rule 4): a present-but-
// unresolvable key is refused before the handler runs; a resolvable one passes; an absent one is
// tolerated during the rollout; no verifier configured means no check.
func TestDispatchNativeKeyVerification(t *testing.T) {
	t.Parallel()
	var called bool
	handlers := map[string]Handler{
		"do": func(_ context.Context, _ json.RawMessage) (json.RawMessage, error) {
			called = true
			return json.RawMessage(`{"ok":true}`), nil
		},
	}
	verify := func(k string) (string, bool) { return "fiber1", k == "good" }

	tests := []struct {
		name       string
		raw        string
		wantCalled bool
		wantErr    bool
	}{
		{"resolvable key passes", `{"op":"do","native_key":"good"}`, true, false},
		{"forged key refused before handler", `{"op":"do","native_key":"bad"}`, false, true},
		{"absent key tolerated (rollout)", `{"op":"do"}`, true, false},
	}
	for _, tc := range tests {
		s := &Server{log: slog.Default(), handlers: handlers, verify: verify}
		called = false
		resp := string(s.dispatch(context.Background(), []byte(tc.raw)))
		if called != tc.wantCalled {
			t.Errorf("%s: handler called=%v, want %v", tc.name, called, tc.wantCalled)
		}
		if gotErr := strings.Contains(resp, `"error"`); gotErr != tc.wantErr {
			t.Errorf("%s: error=%v, want %v (%s)", tc.name, gotErr, tc.wantErr, resp)
		}
	}

	sOff := &Server{log: slog.Default(), handlers: handlers, verify: nil}
	called = false
	sOff.dispatch(context.Background(), []byte(`{"op":"do","native_key":"bogus"}`))
	if !called {
		t.Error("no verifier configured: handler must run regardless of key")
	}
}
