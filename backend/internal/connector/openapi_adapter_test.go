// openapi_adapter_test.go —— 后端内部 UT（进程内 httptest，不出服务边界）。钉死归一化的
// 「最后一公里」：一份 spec+binding 装配出的连接器，**真**实现 usecases.CalendarProxy，
// 且把执行核错映射成 calendar 域错（友好降级）。证明 booker 只认契约、背后 provider 无关。

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
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
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

// fakeStore —— 测试用 ConnectionStore：恒 connected，bearer 凭据 {token}。
type fakeStore struct{ connected bool }

func (f fakeStore) Get(
	_ context.Context, connectorID, _ string,
) (domain.ConnectorConnection, error) {
	return domain.ConnectorConnection{
		ConnectorID: connectorID, Connected: f.connected,
		Credentials: []byte(`{"token":"x"}`),
	}, nil
}

func (fakeStore) SaveTokens(
	_ context.Context, _, _ string, _ *connector.TokenRefresh,
) error {
	return nil
}

//nolint:ireturn // 测试辅助：返回契约接口供断言；同生产侧 AssembleOpenAPI 的工厂意图。
func assembleCal(t *testing.T, h http.Handler) (usecases.CalendarProxy, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	m := &connector.Manifest{
		ID: "google-calendar", Kind: "openapi", Category: "calendar",
		Spec:    []byte(strings.ReplaceAll(calSpecTmpl, "%SERVER%", srv.URL)),
		Binding: []byte(calBindingYAML),
	}
	c, err := connector.AssembleOpenAPI(m, http.DefaultClient, fakeStore{connected: true})
	if err != nil {
		t.Fatalf("AssembleOpenAPI: %v", err)
	}
	cal, ok := c.(usecases.CalendarProxy)
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

	busy, err := cal.FreeBusy(context.Background(), "owner-1", usecases.FreeBusyReq{
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
		w.WriteHeader(http.StatusServiceUnavailable) // 5xx → 可退避瞬时
	}))
	defer srv.Close()

	_, err := cal.FreeBusy(context.Background(), "owner-1", usecases.FreeBusyReq{})
	if !errors.Is(err, domain.ErrCalendarUnavailable) {
		t.Fatalf("5xx should map to ErrCalendarUnavailable, got %v", err)
	}
}
