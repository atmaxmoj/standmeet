// runtime_test.go — backend-internal unit tests (no third parties, never crosses this
// service's boundary: an in-process httptest stand-in replaces the SaaS). Pins down the
// normalization execution core's pure logic: spec/binding parsing + two-way JSONata shape
// normalization + status-code degradation. The real end-to-end assembly → connect → consume
// path is covered by e2e (connector-binding-jsonata.spec.ts).

package openapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const calSpec = `
openapi: 3.0.3
info: { title: Cal, version: "1" }
servers: [{ url: "%SERVER%" }]
paths:
  /freeBusy: { post: { operationId: freebusy.query } }
  /events: { post: { operationId: events.insert } }
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer }
`

const calBinding = `
category: calendar
kind: openapi
operations:
  list_busy:
    op: freebusy.query
    request: '{ "timeMin": timeMin, "timeMax": timeMax, "items": [{"id": "primary"}] }'
    response: '{ "busy": calendars.primary.busy }'
  create_event:
    op: events.insert
  cancel_event:
    op: events.insert
`

func newCalRuntime(t *testing.T, h http.Handler) (*Runtime, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	spec, err := ParseSpec([]byte(strings.ReplaceAll(calSpec, "%SERVER%", srv.URL)))
	mustNoErr(t, "ParseSpec", err)
	binding, berr := ParseBinding([]byte(calBinding))
	mustNoErr(t, "ParseBinding", berr)
	mustNoErr(t, "ValidateAgainst", binding.ValidateAgainst(spec))
	rt, rerr := NewRuntime(spec, binding, srv.Client())
	mustNoErr(t, "NewRuntime", rerr)
	return rt, srv
}

func bearerAuth(req *http.Request) error {
	req.Header.Set("Authorization", "Bearer tok")
	return nil
}

type busyInterval struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type busyOut struct {
	Busy []busyInterval `json:"busy"`
}

type listBusyIn struct {
	TimeMin string `json:"timeMin"`
	TimeMax string `json:"timeMax"`
}

func TestRuntime_ListBusy_RequestShape(t *testing.T) {
	t.Parallel()
	rec := &reqRecorder{body: `{"calendars":{"primary":{"busy":[]}}}`}
	rt, srv := newCalRuntime(t, rec)
	defer srv.Close()

	var out busyOut
	in := listBusyIn{TimeMin: "2030-01-01T00:00:00Z", TimeMax: "2030-01-02T00:00:00Z"}
	mustNoErr(t, "Call", rt.Call(context.Background(), "list_busy", in, &out, bearerAuth))

	if rec.path != "/freeBusy" {
		t.Fatalf("hit wrong path: %q", rec.path)
	}
	var got struct {
		TimeMin string `json:"timeMin"`
	}
	mustNoErr(t, "decode request", json.Unmarshal(rec.raw, &got))
	if got.TimeMin != "2030-01-01T00:00:00Z" {
		t.Fatalf("request JSONata wrong timeMin: %q", got.TimeMin)
	}
}

func TestRuntime_ListBusy_ResponseShape(t *testing.T) {
	t.Parallel()
	rec := &reqRecorder{body: `{"calendars":{"primary":{"busy":[` +
		`{"start":"2030-01-01T10:00:00Z","end":"2030-01-01T11:00:00Z"}]}}}`}
	rt, srv := newCalRuntime(t, rec)
	defer srv.Close()

	var out busyOut
	mustNoErr(t, "Call", rt.Call(context.Background(), "list_busy", listBusyIn{}, &out, bearerAuth))
	if len(out.Busy) != 1 || out.Busy[0].Start != "2030-01-01T10:00:00Z" {
		t.Fatalf("response JSONata wrong: %+v", out.Busy)
	}
}

func TestRuntime_RateLimited_TransientError(t *testing.T) {
	t.Parallel()
	rt, srv := newCalRuntime(t, &reqRecorder{status: http.StatusTooManyRequests})
	defer srv.Close()

	err := rt.Call(context.Background(), "list_busy", listBusyIn{}, nil, bearerAuth)
	var se *StatusError
	if !errors.As(err, &se) {
		t.Fatalf("want *StatusError, got %T (%v)", err, err)
	}
	if se.Code != http.StatusTooManyRequests || !se.Transient {
		t.Fatalf("429 should be transient: %+v", se)
	}
}

func TestRuntime_MissingResponseField_Graceful(t *testing.T) {
	t.Parallel()
	rt, srv := newCalRuntime(t, &reqRecorder{body: `{}`}) // missing calendars.primary.busy
	defer srv.Close()

	var out busyOut
	mustNoErr(t, "Call", rt.Call(context.Background(), "list_busy", listBusyIn{}, &out, bearerAuth))
	if len(out.Busy) != 0 {
		t.Fatalf("missing field should degrade to empty, got %+v", out.Busy)
	}
}

// reqRecorder — an in-process handler that records the received request + returns a preset
// body/status code.
type reqRecorder struct {
	body   string
	path   string
	raw    []byte
	status int
}

func (rr *reqRecorder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rr.path = r.URL.Path
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	rr.raw = raw
	if rr.status != 0 {
		w.WriteHeader(rr.status)
		return
	}
	if _, werr := io.WriteString(w, rr.body); werr != nil {
		panic(werr)
	}
}

func mustNoErr(t *testing.T, what string, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
}

// TestSubstitutePath — {param} substitution + PathEscape: an injected value (containing `/`)
// gets escaped and cannot escape the intended path.
func TestSubstitutePath(t *testing.T) {
	const evPath = "/events/{eventId}"
	cases := []struct {
		name  string
		path  string
		input any
		want  string
	}{
		{"plain", evPath, map[string]any{"eventId": "abc"}, "/events/abc"},
		{
			"escapes slash injection", evPath,
			map[string]any{"eventId": "../../admin"},
			"/events/..%2F..%2Fadmin",
		},
		{"escapes query/hash", "/x/{p}", map[string]any{"p": "a?b#c"}, "/x/a%3Fb%23c"},
		{"missing param kept", evPath, map[string]any{}, evPath},
		{"non-map input unchanged", evPath, "notamap", evPath},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := substitutePath(c.path, c.input); got != c.want {
				t.Fatalf("substitutePath(%q) = %q, want %q", c.path, got, c.want)
			}
		})
	}
}
