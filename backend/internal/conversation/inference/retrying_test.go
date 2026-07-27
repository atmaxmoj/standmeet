package inference

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// TestRetryTransportNotifiesRetry —— transient 失败重试时,transport 必须经
// ctx 通知器把 attempt 喊出来(给 sink emit `retrying` 用)。这是"throbber 显
// retrying"整条链的源头:transport(深层)→ ctx 回调 → sink。
func TestRetryTransportNotifiesRetry(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(failTwiceThenOK())
	defer srv.Close()

	rec := &attemptRec{}
	ctx := withRetryNotifier(context.Background(), rec.add)
	doReqCtxStatus(ctx, t, srv.URL)

	rec.requireSeq(t, 1, 2)
}

// TestSSESinkRetryingFrame —— sink.Retrying 写出一帧 `event: retrying` 带
// attempt;前端据此把 throbber 文案切到 "retrying"。
func TestSSESinkRetryingFrame(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	sink := &sseSink{log: discardLog(), w: rec, flusher: pickFlusher(rec)}

	sink.Retrying(2)

	body := rec.Body.String()
	if !strings.Contains(body, "event: retrying") {
		t.Fatalf("want `event: retrying` frame, got %q", body)
	}
	if !strings.Contains(body, `"attempt":2`) {
		t.Fatalf("want attempt 2 in payload, got %q", body)
	}
}

// failTwiceThenOK —— 前两次 503,第三次 200(触发两次重试)。
func failTwiceThenOK() http.HandlerFunc {
	var hits atomic.Int32
	return func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) <= 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

// doReqCtxStatus —— 带 ctx 走 retry client 打一次请求,drain+close body。
func doReqCtxStatus(ctx context.Context, t *testing.T, url string) {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := retryHTTPClient(false).Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if _, cerr := io.Copy(io.Discard, resp.Body); cerr != nil {
		t.Errorf("drain body: %v", cerr)
	}
	if cerr := resp.Body.Close(); cerr != nil {
		t.Errorf("close body: %v", cerr)
	}
}

// attemptRec —— 线程安全地收 retry 通知里的 attempt 序列。
type attemptRec struct {
	attempts []int
	mu       sync.Mutex
}

func (r *attemptRec) add(a int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.attempts = append(r.attempts, a)
}

func (r *attemptRec) requireSeq(t *testing.T, want ...int) {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.attempts) != len(want) {
		t.Fatalf("want notify attempts %v, got %v", want, r.attempts)
	}
	for i, w := range want {
		if r.attempts[i] != w {
			t.Fatalf("attempt[%d]: want %d, got %v", i, w, r.attempts)
		}
	}
}
