// public_turn_cap_test.go — the per-IP daily cap on owner-paid PUBLIC turns (one anonymous visitor
// can't drain the owner's gas tank now the page answers codeless questions on the owner's model).
// Only mode=="public" is counted: a code is an invited guest, byoai spends the visitor's own money.
// Over the cap → 403 public_rate_limited, which the reader's page turns into the BYOAI fallback.

package public

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

type fakePublicTurnGuard struct {
	over  bool
	calls int
}

func (g *fakePublicTurnGuard) OverLimit(context.Context, string) bool {
	g.calls++
	return g.over
}

type capCase struct {
	name      string
	mode      string
	over      bool
	wantAllow bool
	wantCalls int
}

func TestEnforcePublicTurnCap(t *testing.T) {
	t.Parallel()
	cases := []capCase{
		{"public over the cap is blocked", "public", true, false, 1},
		{"public under the cap passes", "public", false, true, 1},
		{"a code is never counted", "code", true, true, 0},
		{"byoai is never counted", "byoai", true, true, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			runCapCase(t, c)
		})
	}
}

func runCapCase(t *testing.T, c capCase) {
	t.Helper()
	g := &fakePublicTurnGuard{over: c.over}
	h := &Handlers{Log: slog.Default(), PublicTurnGuard: g}
	w := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(
		context.Background(), http.MethodPost, "/api/v1/agent/turn", http.NoBody,
	)
	auth := authedVisitor{Data: &access.VisitorSessionData{Mode: c.mode}}
	require.Equal(t, c.wantAllow, enforcePublicTurnCapOrWrite(r, h, auth, w))
	require.Equal(t, c.wantCalls, g.calls)
	// A blocked public turn answers 403; an allowed one never wrote a status.
	require.Equal(t, c.wantAllow, w.Code != http.StatusForbidden)
}

func TestEnforcePublicTurnCapNilGuardAllows(t *testing.T) {
	t.Parallel()
	h := &Handlers{Log: slog.Default()} // no PublicTurnGuard wired
	w := httptest.NewRecorder()
	r := httptest.NewRequestWithContext(
		context.Background(), http.MethodPost, "/api/v1/agent/turn", http.NoBody,
	)
	auth := authedVisitor{Data: &access.VisitorSessionData{Mode: "public"}}
	require.True(t, enforcePublicTurnCapOrWrite(r, h, auth, w), "a nil guard must allow")
}
