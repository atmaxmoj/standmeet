package inference

import (
	"context"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/secret"
)

// stubLookup —— a fixed owner provider, so the resolver test turns only on ResolveInput.Model.
type stubLookup struct{ view OwnerKeyView }

func (s stubLookup) LookupForResolver(context.Context, string, string) (OwnerKeyView, error) {
	return s.view, nil
}

// resolveWithModel —— resolve against a fixed anthropic/haiku provider, with the given per-code
// model override, and return the model the cred ends up on.
func resolveWithModel(t *testing.T, override string) string {
	t.Helper()
	r := &OwnerKeyResolver{Lookup: stubLookup{view: OwnerKeyView{
		Provider: "anthropic", Endpoint: "https://api.anthropic.com",
		Model: "claude-haiku-5-5", Key: secret.New("k"),
	}}}
	cred, err := r.Resolve(context.Background(), &ResolveInput{
		OwnerID: "o1", ProviderID: "p1", Model: override,
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	return cred.Model
}

// TestResolveNoModelOverride —— no override keeps the provider's own model (today's behaviour).
func TestResolveNoModelOverride(t *testing.T) {
	t.Parallel()
	if got := resolveWithModel(t, ""); got != "claude-haiku-5-5" {
		t.Fatalf("model = %q, want claude-haiku-5-5", got)
	}
}

// TestResolveModelOverrideWins —— a code's pinned model wins over the provider's own: the
// one-key-two-models lever (haiku for chat, sonnet for a specific code's cue).
func TestResolveModelOverrideWins(t *testing.T) {
	t.Parallel()
	if got := resolveWithModel(t, "claude-sonnet-5-5"); got != "claude-sonnet-5-5" {
		t.Fatalf("model = %q, want claude-sonnet-5-5", got)
	}
}
