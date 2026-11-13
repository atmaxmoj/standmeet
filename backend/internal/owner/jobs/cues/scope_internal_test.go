// scope_internal_test.go —— a bound code drives the cue's note scope: the card uses what that
// code can read (its assumed role's grant minus the code's denials), not a separately-picked role.

package cues

import (
	"context"
	"slices"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// scopePorts —— stub ports that resolve a role ref and a code to a scope, and admit a fixed note
// set by the grant/deny the deck passes to Notes. It records the last (granted, denied) so the test
// can prove the code's scope — not the role ref's — reached the note load.
type scopePorts struct {
	roleGrant []string // what the role ref grants
	codeGrant []string // what the bound code's assumed role grants
	codeDeny  []string // what the bound code takes back
	lastGrant []string
	lastDeny  []string
}

func (s *scopePorts) ports() Ports {
	return Ports{
		Role: func(_ context.Context, _, ref string) (Role, error) {
			return Role{ID: "role-" + ref, Name: ref, CorpusURIs: s.roleGrant}, nil
		},
		CodeScope: func(_ context.Context, _, code string) (Role, error) {
			if code == "nope" {
				return Role{}, ErrCodeNoScope
			}
			return Role{
				ID: "code-role", Name: "Backend",
				CorpusURIs: s.codeGrant, DeniedURIs: s.codeDeny,
			}, nil
		},
		Notes: func(_ context.Context, _ string, granted, denied []string) ([]Note, error) {
			s.lastGrant, s.lastDeny = granted, denied
			var out []Note
			for _, g := range granted {
				if slices.Contains(denied, g) {
					continue // the code took it back
				}
				out = append(out, Note{Title: g, Path: g, Genre: "wiki"})
			}
			return out, nil
		},
		Version: func(_ context.Context, _ string) (string, error) { return "v1", nil },
		Screen:  func(_ context.Context, _ string) (Screen, error) { return Screen{}, nil },
	}
}

func prepareWith(t *testing.T, p *scopePorts, ref, code string) Prepared {
	t.Helper()
	// A live Feed (Prepare starts the owner's cue session on it — the per-owner singleton); a nil
	// Feed would nil-panic in StartSession. miniredis keeps it in-process.
	feed := New(redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()}))
	a := NewAssistant(feed, p.ports())
	got, err := a.Prepare(context.Background(), "owner1", ref, code)
	if err != nil {
		t.Fatalf("Prepare(ref=%q, code=%q): %v", ref, code, err)
	}
	return got
}

// A bound code scopes the deck to the code's grant minus its denials, even when a role ref is also
// given — the code wins, and the denied glob is subtracted.
func TestPrepareCodeScopeWinsAndSubtracts(t *testing.T) {
	t.Parallel()
	p := &scopePorts{
		roleGrant: []string{"wiki://x", "wiki://y", "wiki://z"}, // the role ref would give 3
		codeGrant: []string{"wiki://a", "wiki://b"},
		codeDeny:  []string{"wiki://b"}, // the code takes b back
	}
	got := prepareWith(t, p, "some-role", "code-123")
	if got.Notes != 1 {
		t.Fatalf("code scope: notes = %d, want 1 (grant a,b minus deny b)", got.Notes)
	}
	if !slices.Equal(p.lastGrant, p.codeGrant) || !slices.Equal(p.lastDeny, p.codeDeny) {
		t.Fatalf("Notes got grant=%v deny=%v, want the code's grant=%v deny=%v",
			p.lastGrant, p.lastDeny, p.codeGrant, p.codeDeny)
	}
}

// No code: the deck is scoped by the role ref, with no denials — unchanged behaviour.
func TestPrepareNoCodeUsesRole(t *testing.T) {
	t.Parallel()
	p := &scopePorts{roleGrant: []string{"wiki://x", "wiki://y", "wiki://z"}}
	got := prepareWith(t, p, "some-role", "")
	if got.Notes != 3 {
		t.Fatalf("role scope: notes = %d, want 3", got.Notes)
	}
	if len(p.lastDeny) != 0 {
		t.Fatalf("role path passed denials %v, want none", p.lastDeny)
	}
}

// A code that binds no usable scope (invalid / foreign) falls back to the role ref.
func TestPrepareCodeNoScopeFallsBackToRole(t *testing.T) {
	t.Parallel()
	p := &scopePorts{roleGrant: []string{"wiki://x", "wiki://y"}}
	got := prepareWith(t, p, "some-role", "nope")
	if got.Notes != 2 {
		t.Fatalf("fallback: notes = %d, want 2 (role ref)", got.Notes)
	}
}
