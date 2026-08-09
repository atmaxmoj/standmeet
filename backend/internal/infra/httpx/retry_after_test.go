// retry_after_test.go —— F-A-31:429 带来的 `Retry-After` 是 provider 明说的「等这么久再来」。
// 在这条测试出现之前,退避表是我们自己的指数序列,那个头**从来没有被读过** —— 于是对着一个真的
// 限流的 provider,我们会比它要求的更早重打,而那正是加重封禁的行为。
//
// 断的是**等了多久**,不是「有没有读那个头」:后者可以用一行 `resp.Header.Get` 骗过去而不改变任何
// 行为。所以每条都发头 + 量时间。
//
// 这几条必须留在 Go 侧:e2e 从界面上看不出「等了 1 秒还是 1 毫秒」,而这正是本条的全部内容。

package httpx_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const (
	// retryAfterSeconds —— 用最小的合法秒数。1s 让用例慢一点,但这就是这条要测的量。
	retryAfterSeconds = 1
	// dateFormFloor —— HTTP-date 只到秒,目标时刻落在这一秒的哪个位置不定;这个下限仍然把
	// 「一毫秒就重打」挡在外面(那才是这条要防的),同时不会因为秒的截断而假红。
	dateFormFloor = 900 * time.Millisecond
	// hostileRetryAfter —— 远超调用方截止时间的间隔:正确动作是不重试,不是睡满预算。
	hostileRetryAfter = "3600"
)

func TestWaitsAtLeastRetryAfterSeconds(t *testing.T) {
	t.Parallel()
	st := &stubRT{responses: []stubResp{
		{status: http.StatusTooManyRequests, retryAfter: "1"},
		{status: http.StatusOK},
	}}
	// BaseDelay 是微秒级:任何「等够了」都只能来自那个头,不可能来自我们自己的退避。
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
	// HTTP-date 是 `Retry-After` 的另一种合法写法,真 provider 两种都发。
	//
	// 用 +2s 而不是 +1s:`http.TimeFormat` 只精确到秒,格式化会把当前这一秒的小数部分**截掉**,
	// 所以 now+1s 写出来之后实际间隔是 (1s − 小数部分),最坏接近 0。+2s 保证截断后仍 > 1s。
	// (第一版我写的是 +1s,量到 464ms —— 那不是代码没等,是这个头本来就只要求了 464ms。)
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

// TestRetryAfterBeyondDeadlineStopsInsteadOfSleeping —— provider 要求的间隔超出调用方的截止时间时,
// 正确的动作是**不重试、把 429 交回去**(让上面渲一句人话),而不是把剩下的预算全部睡掉再失败。
// 「不早于它要求的时间重打」和「不把调用方的截止拖死」两件事都要成立。
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

// doWithDeadline —— 在一个带截止时间的 ctx 上打一次请求,返状态码和真实耗时。
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
