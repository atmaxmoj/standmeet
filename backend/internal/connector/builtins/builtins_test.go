// builtins_test.go —— 后端内部 UT：内置连接器数据拉起时真能 Load + 装配（不出服务边界，
// 不打网络——只验 manifest 自洽 + AssembleOpenAPI 成功）。证明「外置成数据、拉起时组装」成立。

package builtins_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/builtins"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type fakeStore struct{}

func (fakeStore) Get(
	_ context.Context, connectorID, _ string,
) (domain.ConnectorConnection, error) {
	return domain.ConnectorConnection{ConnectorID: connectorID, Connected: true}, nil
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
	ms, err := builtins.Load()
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
	ms, err := builtins.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	gcal := mustFind(t, ms, "google-calendar")
	c, aerr := connector.AssembleOpenAPI(&gcal, http.DefaultClient, fakeStore{})
	if aerr != nil {
		t.Fatalf("assemble builtin gcal: %v", aerr)
	}
	if _, ok := c.(usecases.CalendarProxy); !ok {
		t.Fatalf("gcal builtin is not a CalendarProxy: %T", c)
	}
}
