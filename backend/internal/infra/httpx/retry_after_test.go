// retry_after_test.go —— F-A-31: the `Retry-After` a 429 carries is the provider explicitly
// saying "come back after this long". Before this test existed, the backoff table was our own
// exponential sequence and that header had **never once been read** — so against a provider
// that's actually rate-limiting us, we'd retry earlier than it asked, which is exactly the
// behavior that makes a ban worse.
//
// What's asserted is **how long we waited**, not "did we read that header": the latter can be
// faked with a one-line `resp.Header.Get` that changes no actual behavior. So every case here
// sends the header + measures elapsed time.
//
// These have to stay on the Go side: e2e can't tell from the UI whether it waited 1 second or
// 1 millisecond, and that distinction is this whole test's point.

package httpx_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	// retryAfterSeconds —— the smallest legal number of seconds. 1s slows the test case down
	// a bit, but that's exactly the quantity being tested.
	retryAfterSeconds = 1
	// dateFormFloor —— an HTTP-date is only precise to the second, so where the target moment
	// falls within that second is undetermined; this floor still keeps out "retried after
	// 1ms" (the thing this test guards against) while not going red from second-truncation.
	dateFormFloor = 900 * time.Millisecond
	// hostileRetryAfter —— an interval far beyond the caller's deadline: the correct move is
	// not to retry, not to sleep away the whole budget.
	hostileRetryAfter = "3600"
)

func TestWaitsAtLeastRetryAfterSeconds(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{
		{status: http.StatusTooManyRequests, retryAfter: "1"},
		{status: http.StatusOK},
	}}
	// BaseDelay is microsecond-scale: any "waited long enough" can only come from that
	// header, never from our own backoff.
	c := httpx.NewClient(httpx.Options{
		Base: st, MaxRetries: 2, BaseDelay: time.Microsecond,
	})
	start := time.Now()
	status, err := run(t, c, http.MethodGet, "")
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("want 200 after the wait, got %d", status)
	}
	if st.calls != 2 {
		t.Fatalf("want 2 attempts, got %d", st.calls)
	}
	if elapsed < retryAfterSeconds*time.Second {
		t.Fatalf("retried after %v — the provider asked for %ds", elapsed, retryAfterSeconds)
	}
}

func TestWaitsAtLeastRetryAfterHTTPDate(t *testing.T) {
	t.Parallel()
	// HTTP-date is `Retry-After`'s other legal form, and real providers send both.
	//
	// Use +2s rather than +1s: `http.TimeFormat` is only precise to the second, so
	// formatting **truncates** the fractional part of the current second. So a written-out
	// now+1s ends up with an actual interval of (1s − the truncated fraction), worst case
	// close to 0. +2s guarantees it stays > 1s after truncation.
	// (The first version used +1s and measured 464ms — that wasn't the code failing to wait,
	// it's that this header only asked for 464ms to begin with.)
	when := time.Now().UTC().Add(2 * time.Second).Format(http.TimeFormat)
	st := &stubRT{responses: []stubResp{
		{status: http.StatusTooManyRequests, retryAfter: when},
		{status: http.StatusOK},
	}}
	c := httpx.NewClient(httpx.Options{
		Base: st, MaxRetries: 2, BaseDelay: time.Microsecond,
	})
	start := time.Now()
	if _, err := run(t, c, http.MethodGet, ""); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed < dateFormFloor {
		t.Fatalf("retried after %v — the provider named a later time", elapsed)
	}
}

// TestRetryAfterBeyondDeadlineStopsInsteadOfSleeping —— when the interval the provider asks
// for exceeds the caller's deadline, the correct move is **don't retry, hand the 429 back**
// (so a layer above can render a human sentence), instead of sleeping away the whole remaining
// budget and failing anyway. Both "never retry earlier than asked" and "never drag the
// caller's deadline out to death" must hold.
func TestRetryAfterBeyondDeadlineStopsInsteadOfSleeping(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{
		{status: http.StatusTooManyRequests, retryAfter: hostileRetryAfter},
		{status: http.StatusOK},
	}}
	c := httpx.NewClient(httpx.Options{
		Base: st, MaxRetries: 2, BaseDelay: time.Microsecond,
	})
	status, elapsed := doWithDeadline(t, c, 2*time.Second)
	if status != http.StatusTooManyRequests {
		t.Fatalf("want the 429 handed back, got %d", status)
	}
	if st.calls != 1 {
		t.Fatalf("must not retry earlier than asked: want 1 attempt, got %d", st.calls)
	}
	if elapsed > time.Second {
		t.Fatalf("burned %v of the caller's budget sleeping instead of giving up", elapsed)
	}
}

// doWithDeadline —— fire one request on a ctx with a deadline; return the status code and the
// actual elapsed time.
func doWithDeadline(t *testing.T, c *http.Client, budget time.Duration) (int, time.Duration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), budget)
	defer cancel()
	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, "http://x", http.NoBody)
	if rerr != nil {
		t.Fatal(rerr)
	}
	start := time.Now()
	resp, err := c.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("want a response handed back, got err: %v", err)
	}
	if cerr := resp.Body.Close(); cerr != nil {
		t.Errorf("close body: %v", cerr)
	}
	return resp.StatusCode, elapsed
}
