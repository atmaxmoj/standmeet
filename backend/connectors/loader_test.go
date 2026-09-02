// loader_test.go —— backend-internal UT: builtin connector data really does Load +
// assemble at launch (no service boundary crossed, no network hit — only checks manifest
// self-consistency + AssembleOpenAPI succeeding). Proves "externalized into data, assembled
// at launch" holds.

package connectors_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/connectors"
	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

// TestLoad_GCalScopesAreFullURLs —— F-B-3. The gcal OAuth scopes must be the FULL
// Google scope URLs; bare names (calendar.readonly) → "invalid_scope" at the real
// accounts.google.com (the e2e mock accepts any scope, so only real Google — or
// this guard — catches it). Real-GUI regression surfaced it after F-B-2 unmasked
// the dance.
func TestLoad_GCalScopesAreFullURLs(t *testing.T) {
	t.Parallel()
	ms, err := connectors.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	gcal := mustFind(t, ms, "google-calendar")
	spec := string(gcal.Spec)
	for _, full := range []string{
		"https://www.googleapis.com/auth/calendar.readonly",
		"https://www.googleapis.com/auth/calendar.events",
	} {
		if !strings.Contains(spec, full) {
			t.Errorf("gcal spec missing full-URL scope %q (bare names → invalid_scope)", full)
		}
	}
}

type fakeStore struct{}

func (fakeStore) Get(
	_ context.Context, connectorID, _ string,
) (connector.Connection, error) {
	return connector.Connection{ConnectorID: connectorID, Connected: true}, nil
}

func (fakeStore) SaveTokens(
	_ context.Context, _, _ string, _ *connector.TokenRefresh,
) error {
	return nil
}

func (fakeStore) MarkDisconnected(_ context.Context, _, _ string) error {
	return nil
}

func mustFind(t *testing.T, ms []connector.Manifest, id string) connector.Manifest {
	t.Helper()
	for i := range ms {
		if ms[i].ID == id {
			return ms[i]
		}
	}
	t.Fatalf("builtin connector %q not found", id)
	return connector.Manifest{}
}

func TestLoad_ReturnsBuiltinManifests(t *testing.T) {
	t.Parallel()
	ms, err := connectors.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	gcal := mustFind(t, ms, "google-calendar")
	assertManifest(t, &gcal, "openapi", "calendar")
	smtp := mustFind(t, ms, "smtp")
	assertManifest(t, &smtp, "protocol", "mail")
}

func assertManifest(t *testing.T, m *connector.Manifest, kind, category string) {
	t.Helper()
	if m.Kind != kind || m.Category != category {
		t.Fatalf("builtin %q manifest wrong: %+v", m.ID, m)
	}
}

func TestLoad_GcalAssemblesAtLaunch(t *testing.T) {
	t.Parallel()
	ms, err := connectors.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	gcal := mustFind(t, ms, "google-calendar")
	c, aerr := connector.AssembleOpenAPI(&gcal, http.DefaultClient, fakeStore{}, nil)
	if aerr != nil {
		t.Fatalf("assemble builtin gcal: %v", aerr)
	}
	if _, ok := c.(contract.CalendarProxy); !ok {
		t.Fatalf("gcal builtin is not a CalendarProxy: %T", c)
	}
}
