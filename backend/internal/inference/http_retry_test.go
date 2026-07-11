package inference

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// TestRetryTransportRetriesTransient5xx —— transient 5xx 应被重试,最终拿到 200。
func TestRetryTransportRetriesTransient5xx(t *testing.T) {
	t.Parallel()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) <= 2 { // fail twice
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	if status := doReqStatus(t, srv.URL); status != http.StatusOK {
		t.Fatalf("want 200 after retries, got %d", status)
	}
	if got := hits.Load(); got != 3 {
		t.Fatalf("want 3 upstream hits (2 fail + 1 ok), got %d", got)
	}
}

// TestRetryTransportNoRetryOn4xx —— 4xx 是确定性失败,不重试。
func TestRetryTransportNoRetryOn4xx(t *testing.T) {
	t.Parallel()
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()

	doReqStatus(t, srv.URL)
	if got := hits.Load(); got != 1 {
		t.Fatalf("4xx must not retry; want 1 hit, got %d", got)
	}
}

// doReqStatus —— 走 retry client 打一次请求,返回状态码,顺手 drain+close body。
func doReqStatus(t *testing.T, url string) int {
	t.Helper()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := retryHTTPClient(false).Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	status := resp.StatusCode
	if _, cerr := io.Copy(io.Discard, resp.Body); cerr != nil {
		t.Errorf("drain body: %v", cerr)
	}
	if cerr := resp.Body.Close(); cerr != nil {
		t.Errorf("close body: %v", cerr)
	}
	return status
}
