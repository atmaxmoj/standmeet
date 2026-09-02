package httpx_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

// stubRT —— a programmable base RoundTripper: returns per the responses sequence, records
// attempt count and the last request body.
type stubRT struct {
	lastBody  string
	responses []stubResp
	calls     int
}

type stubResp struct {
	err error
	// retryAfter —— when non-empty, sent as the `Retry-After` header on this response (the
	// provider saying "come back after this long").
	retryAfter string
	status     int
}

func (s *stubRT) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Body != nil {
		b, rerr := io.ReadAll(req.Body)
		if rerr == nil {
			s.lastBody = string(b)
		}
	}
	r := s.responses[s.calls]
	s.calls++
	if r.err != nil {
		return nil, r.err
	}
	hdr := http.Header{}
	if r.retryAfter != "" {
		hdr.Set("Retry-After", r.retryAfter)
	}
	return &http.Response{
		StatusCode: r.status, Header: hdr,
		Body: io.NopCloser(strings.NewReader("ok")),
	}, nil
}

// fastClient —— a tiny backoff so retry tests don't idle; goes through NewClient's full
// public surface.
func fastClient(
	base http.RoundTripper, onRetry func(context.Context, httpx.RetryInfo),
) *http.Client {
	return httpx.NewClient(httpx.Options{
		Base: base, OnRetry: onRetry, MaxRetries: 2, BaseDelay: time.Microsecond,
	})
}

func newReq(t *testing.T, method, body string) *http.Request {
	t.Helper()
	var rdr io.Reader = http.NoBody
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(context.Background(), method, "http://x", rdr)
	if err != nil {
		t.Fatal(err)
	}
	return req
}

// run —— fire one request; on success drain+close the body (with error checking) and return
// the status code, otherwise return the error.
func run(t *testing.T, c *http.Client, method, body string) (int, error) {
	t.Helper()
	resp, err := c.Do(newReq(t, method, body))
	if err != nil {
		return 0, fmt.Errorf("do: %w", err)
	}
	if _, cerr := io.Copy(io.Discard, resp.Body); cerr != nil {
		t.Errorf("drain body: %v", cerr)
	}
	if cerr := resp.Body.Close(); cerr != nil {
		t.Errorf("close body: %v", cerr)
	}
	return resp.StatusCode, nil
}

func TestRetriesTransientThenSucceeds(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{
		{status: http.StatusInternalServerError},
		{status: http.StatusTooManyRequests},
		{status: http.StatusOK},
	}}
	var retries int
	c := fastClient(st, func(context.Context, httpx.RetryInfo) { retries++ })
	status, err := run(t, c, http.MethodGet, "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("want 200 after retries, got %d", status)
	}
	if st.calls != 3 {
		t.Fatalf("want 3 attempts (2 retries), got %d", st.calls)
	}
	if retries != 2 {
		t.Fatalf("OnRetry should fire twice, got %d", retries)
	}
}

func TestGivesUpAfterMax(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{
		{status: http.StatusBadGateway},
		{status: http.StatusBadGateway},
		{status: http.StatusBadGateway},
	}}
	status, err := run(t, fastClient(st, nil), http.MethodGet, "")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if status != http.StatusBadGateway {
		t.Fatalf("want last 502, got %d", status)
	}
	if st.calls != 3 { // 1 + max(2)
		t.Fatalf("want 3 attempts, got %d", st.calls)
	}
}

func TestNoRetryOn4xx(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{{status: http.StatusUnauthorized}}}
	if _, err := run(t, fastClient(st, nil), http.MethodGet, ""); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if st.calls != 1 {
		t.Fatalf("4xx is deterministic — want 1 attempt, got %d", st.calls)
	}
}

func TestNoRetryOnContextCanceled(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{{err: context.Canceled}}}
	_, err := run(t, fastClient(st, nil), http.MethodGet, "")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want context.Canceled surfaced, got %v", err)
	}
	if st.calls != 1 {
		t.Fatalf("ctx cancel must not retry — want 1 attempt, got %d", st.calls)
	}
}

func TestNoRetryWhenOptedOut(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{{status: http.StatusBadGateway}}}
	c := httpx.NewClient(httpx.Options{Base: st, NoRetry: true})
	if _, err := run(t, c, http.MethodGet, ""); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if st.calls != 1 {
		t.Fatalf("NoRetry must send exactly once, got %d", st.calls)
	}
}

func TestRebuffersPostBodyAcrossRetries(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{
		{status: http.StatusServiceUnavailable}, {status: http.StatusOK},
	}}
	if _, err := run(t, fastClient(st, nil), http.MethodPost, "payload"); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if st.lastBody != "payload" {
		t.Fatalf("retried request must re-send the body, got %q", st.lastBody)
	}
}
