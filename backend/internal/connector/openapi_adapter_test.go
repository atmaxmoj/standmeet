// openapi_adapter_test.go — backend-internal unit test (in-process httptest, never crosses the
// service boundary). Pins down the normalized "last mile": a connector assembled from one
// spec+binding **actually** implements contract.CalendarProxy, and maps execution-core errors
// to calendar-domain errors (friendly downgrade). Proves booker only knows the contract, with
// no idea what provider is behind it.

package connector_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

const futureYear = 2030

const calSpecTmpl = `
openapi: 3.0.3
info: { title: Cal, version: "1" }
servers: [{ url: "%SERVER%" }]
paths:
  /freeBusy: { post: { operationId: freebusy.query } }
  /events: { post: { operationId: events.insert } }
  /events/del: { post: { operationId: events.delete } }
components:
  securitySchemes: { bearer: { type: http, scheme: bearer } }
`

const calBindingYAML = `
category: calendar
kind: openapi
operations:
  list_busy:
    op: freebusy.query
    request: '{ "timeMin": timeMin, "timeMax": timeMax }'
    response: '{ "busy": calendars.primary.busy }'
  create_event:
    op: events.insert
    request: '{ "summary": summary }'
    response: '{ "id": id, "htmlLink": htmlLink }'
  cancel_event:
    op: events.delete
`

// fakeStore — a test ConnectionStore: always connected, bearer credentials {token}.
type fakeStore struct{ connected bool }

func (f fakeStore) Get(
	_ context.Context, connectorID, _ string,
) (connector.Connection, error) {
	return connector.Connection{
		ConnectorID: connectorID, Connected: f.connected,
		Credentials: []byte(`{"token":"x"}`),
	}, nil
}

func (fakeStore) SaveTokens(
	_ context.Context, _, _ string, _ *connector.TokenRefresh,
) error {
	return nil
}

func (fakeStore) MarkDisconnected(_ context.Context, _, _ string) error {
	return nil
}

func assembleCal(t *testing.T, h http.Handler) (contract.CalendarProxy, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	m := &connector.Manifest{
		ID: "google-calendar", Kind: "openapi", Category: "calendar",
		Spec:    []byte(strings.ReplaceAll(calSpecTmpl, "%SERVER%", srv.URL)),
		Binding: []byte(calBindingYAML),
	}
	loopback := connector.NewEgressAllow([]string{"127.0.0.1"}) // httptest server runs on loopback
	c, err := connector.AssembleOpenAPI(m, http.DefaultClient, fakeStore{connected: true}, loopback)
	if err != nil {
		t.Fatalf("AssembleOpenAPI: %v", err)
	}
	cal, ok := c.(contract.CalendarProxy)
	if !ok {
		t.Fatalf("assembled calendar connector is not a CalendarProxy: %T", c)
	}
	return cal, srv
}

func TestAssembleOpenAPI_CalendarContract_FreeBusy(t *testing.T) {
	t.Parallel()
	cal, srv := assembleCal(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, werr := w.Write([]byte(`{"calendars":{"primary":{"busy":[` +
			`{"start":"2030-01-01T10:00:00Z","end":"2030-01-01T11:00:00Z"}]}}}`)); werr != nil {
			panic(werr)
		}
	}))
	defer srv.Close()

	busy, err := cal.FreeBusy(context.Background(), "owner-1", contract.FreeBusyReq{
		TimeMin: time.Date(futureYear, 1, 1, 0, 0, 0, 0, time.UTC),
		TimeMax: time.Date(futureYear, 1, 2, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("FreeBusy: %v", err)
	}
	if len(busy) != 1 || busy[0].Start.Format(time.RFC3339) != "2030-01-01T10:00:00Z" {
		t.Fatalf("freebusy not mapped through contract: %+v", busy)
	}
}

func TestAssembleOpenAPI_Calendar_TransientDegrades(t *testing.T) {
	t.Parallel()
	cal, srv := assembleCal(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable) // 5xx → transient, can back off and retry
	}))
	defer srv.Close()

	_, err := cal.FreeBusy(context.Background(), "owner-1", contract.FreeBusyReq{})
	if !errors.Is(err, contract.ErrCalendarUnavailable) {
		t.Fatalf("5xx should map to ErrCalendarUnavailable, got %v", err)
	}
}
