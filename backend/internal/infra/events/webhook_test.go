package events_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

// The Standard Webhooks specification's own test vector (cross-checked with
// `openssl dgst -sha256 -mac HMAC`).
const (
	vectorSecret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" //gitleaks:allow
	vectorID     = "msg_p5jXN8AQM9LWM0D4loKWxJek"
	vectorTS     = int64(1614265330)
	vectorBody   = `{"test": 2432232314}`
	vectorSig    = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
)

const (
	msgID       = "id"
	day         = 24 * time.Hour
	decimalBase = 10
	int64Bits   = 64
	thirty      = 30 * time.Second
	slack       = 10 * time.Second
	five        = 5
	// occurredUnix — 2026-09-26T10:00:00Z, the time testEvent happened at (wantBody spells it).
	occurredUnix = 1790416800
)

func mustSecret(t *testing.T) string {
	t.Helper()
	s, err := events.NewWebhookSecret()
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func mustSign(t *testing.T, secret, id string, ts int64, body string) string {
	t.Helper()
	sig, err := events.SignWebhook(secret, id, ts, []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return sig
}

func TestSignWebhookMatchesTheStandardWebhooksVector(t *testing.T) {
	t.Parallel()
	if got := mustSign(t, vectorSecret, vectorID, vectorTS, vectorBody); got != vectorSig {
		t.Fatalf("signature %q, want %q", got, vectorSig)
	}
}

func TestSignatureDependsOnSecretIDTimestampAndBody(t *testing.T) {
	t.Parallel()
	s1, s2 := mustSecret(t), mustSecret(t)
	if s1 == s2 || !strings.HasPrefix(s1, "whsec_") {
		t.Fatalf("secrets %q %q: want two distinct whsec_ values", s1, s2)
	}
	base := mustSign(t, s1, msgID, 1, "b")
	variants := map[string]string{
		"secret": mustSign(t, s2, msgID, 1, "b"),
		"id":     mustSign(t, s1, msgID+"2", 1, "b"),
		"ts":     mustSign(t, s1, msgID, 2, "b"),
		"body":   mustSign(t, s1, msgID, 1, "c"),
	}
	for name, sig := range variants {
		if sig == base {
			t.Errorf("changing the %s left the signature unchanged", name)
		}
	}
}

func TestAMalformedSecretIsRefused(t *testing.T) {
	t.Parallel()
	if _, err := events.SignWebhook("whsec_!!!", msgID, 1, nil); err == nil {
		t.Error("a secret that is not base64 must be refused")
	}
}

func TestWebhookBackoffFollowsTheSvixSchedule(t *testing.T) {
	t.Parallel()
	const longest = 10 * time.Hour
	want := []time.Duration{
		five * time.Second, five * time.Minute, time.Hour / 2, 2 * time.Hour, five * time.Hour,
		longest, longest, longest,
	}
	for i, w := range want {
		if got := events.WebhookBackoff(i + 1); got != w {
			t.Errorf("attempt %d: %s, want %s", i+1, got, w)
		}
	}
}

func TestTheRetriesSpanAboutFiveDays(t *testing.T) {
	t.Parallel()
	var total time.Duration
	for a := 1; a < events.WebhookMaxAttempts; a++ {
		total += events.WebhookBackoff(a)
	}
	if total < five*day || total > (five+1)*day {
		t.Errorf("the retries span %s, want about 5 days", total)
	}
}

type class int

const (
	ok class = iota
	retry
	snooze
	discard
)

func classOf(err error) class {
	if err == nil {
		return ok
	}
	if jobs.IsDiscard(err) {
		return discard
	}
	if _, s := jobs.SnoozeOf(err); s {
		return snooze
	}
	return retry
}

// classifyStatus — the class of an answer with this status and Retry-After ("" = none).
func classifyStatus(t *testing.T, code int, retryAfter string) error {
	t.Helper()
	resp := &http.Response{StatusCode: code, Header: http.Header{}, Body: http.NoBody}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			t.Error(err)
		}
	}()
	if retryAfter != "" {
		resp.Header.Set("Retry-After", retryAfter)
	}
	return events.ClassifyWebhook(resp, nil)
}

func TestClassifyEveryStatusClass(t *testing.T) {
	t.Parallel()
	date := time.Now().Add(time.Minute).UTC().Format(http.TimeFormat)
	cases := []struct {
		retryAfter string
		code       int
		want       class
	}{
		{code: http.StatusOK, want: ok},
		{code: http.StatusNoContent, want: ok},
		{code: http.StatusMovedPermanently, want: retry},
		{code: http.StatusBadRequest, want: discard},
		{code: http.StatusUnauthorized, want: discard},
		{code: http.StatusNotFound, want: discard},
		{code: http.StatusGone, want: discard},
		{code: http.StatusRequestTimeout, want: retry},
		{code: http.StatusTooManyRequests, want: retry},
		{code: http.StatusTooManyRequests, retryAfter: "30", want: snooze},
		{code: http.StatusTooManyRequests, retryAfter: date, want: snooze},
		{code: http.StatusServiceUnavailable, retryAfter: "7", want: snooze},
		{code: http.StatusServiceUnavailable, want: retry},
		{code: http.StatusInternalServerError, want: retry},
		{code: http.StatusBadGateway, want: retry},
	}
	for _, c := range cases {
		if got := classOf(classifyStatus(t, c.code, c.retryAfter)); got != c.want {
			t.Errorf("%d (Retry-After %q): class %d, want %d", c.code, c.retryAfter, got, c.want)
		}
	}
}

func TestClassifyTransportFailures(t *testing.T) {
	t.Parallel()
	for err, want := range map[error]class{
		errors.New("connection refused"): retry,
		context.DeadlineExceeded:         retry,
		httpx.ErrBlockedEgress:           discard,
	} {
		if got := classOf(events.ClassifyWebhook(nil, err)); got != want {
			t.Errorf("%v: class %d, want %d", err, got, want)
		}
	}
}

func TestRetryAfterSecondsSetsTheSnooze(t *testing.T) {
	t.Parallel()
	d, _ := jobs.SnoozeOf(classifyStatus(t, http.StatusTooManyRequests, "30"))
	if d != thirty {
		t.Errorf("seconds form: snooze %s, want 30s", d)
	}
}

func TestRetryAfterDateSetsTheSnooze(t *testing.T) {
	t.Parallel()
	date := time.Now().Add(time.Minute).UTC().Format(http.TimeFormat)
	d, _ := jobs.SnoozeOf(classifyStatus(t, http.StatusServiceUnavailable, date))
	if d < time.Minute-slack || d > time.Minute {
		t.Errorf("date form: snooze %s, want about 1m", d)
	}
}

func testEvent() *events.Event {
	return &events.Event{
		ID: "0192a3b4-0000-7000-8000-000000000001", Type: "corpus.note.changed",
		Subject: "wiki://a/b", OccurredAt: time.Unix(occurredUnix, 0),
		Data: json.RawMessage(`{"op": "updated", "published": true}`),
	}
}

type received struct {
	h    http.Header
	body []byte
}

// recordingSink — an endpoint that records the one request it gets and answers 204.
func recordingSink(t *testing.T) (*httptest.Server, <-chan received) {
	t.Helper()
	seen := make(chan received, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		seen <- received{h: r.Header.Clone(), body: b}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	return srv, seen
}

const wantBody = `{"id":"0192a3b4-0000-7000-8000-000000000001","type":"corpus.note.changed",` +
	`"subject":"wiki://a/b","occurred_at":"2026-09-26T10:00:00Z",` +
	`"data":{"op":"updated","published":true}}`

// deliverOnce — delivers testEvent to a recording sink and returns what the sink got.
func deliverOnce(t *testing.T, secret string) received {
	t.Helper()
	srv, seen := recordingSink(t)
	ctx := context.Background()
	if err := events.DeliverWebhook(ctx, srv.Client(), srv.URL, secret, testEvent()); err != nil {
		t.Fatalf("deliver: %v", err)
	}
	return <-seen
}

func TestDeliveryPostsAThinPayloadUnderTheEventID(t *testing.T) {
	t.Parallel()
	g := deliverOnce(t, mustSecret(t))
	if string(g.body) != wantBody || g.h.Get("Webhook-Id") != testEvent().ID {
		t.Fatalf("body %s, webhook-id %q: want the thin payload and the event id",
			g.body, g.h.Get("Webhook-Id"))
	}
}

func TestDeliveryIsSignedAtTheCurrentTime(t *testing.T) {
	t.Parallel()
	secret := mustSecret(t)
	g := deliverOnce(t, secret)
	n, err := strconv.ParseInt(g.h.Get("Webhook-Timestamp"), decimalBase, int64Bits)
	if err != nil || time.Since(time.Unix(n, 0)).Abs() > time.Minute {
		t.Fatalf("webhook-timestamp %q: want the current unix time", g.h.Get("Webhook-Timestamp"))
	}
	sig := mustSign(t, secret, testEvent().ID, n, string(g.body))
	if g.h.Get("Webhook-Signature") != sig {
		t.Errorf("signature %q does not verify (want %q)", g.h.Get("Webhook-Signature"), sig)
	}
}

// answering — an endpoint that always answers code (with Retry-After: 3 on a 429).
func answering(t *testing.T, code int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if code == http.StatusTooManyRequests {
			w.Header().Set("Retry-After", "3")
		}
		w.WriteHeader(code)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestDeliveryClassifiesTheReceiversAnswer(t *testing.T) {
	t.Parallel()
	secret := mustSecret(t)
	for code, want := range map[int]class{
		http.StatusGone: discard, http.StatusTooManyRequests: snooze,
		http.StatusInternalServerError: retry,
	} {
		srv := answering(t, code)
		ctx := context.Background()
		err := events.DeliverWebhook(ctx, srv.Client(), srv.URL, secret, testEvent())
		if got := classOf(err); got != want {
			t.Errorf("%d: class %d, want %d (%v)", code, got, want, err)
		}
	}
}

func TestTheGuardedClientDiscardsAPrivateTarget(t *testing.T) {
	t.Parallel()
	srv := answering(t, http.StatusOK)
	err := events.DeliverWebhook(context.Background(), events.NewWebhookClient(), srv.URL,
		mustSecret(t), testEvent())
	if !jobs.IsDiscard(err) || !errors.Is(err, httpx.ErrBlockedEgress) {
		t.Fatalf("a loopback URL: %v, want a discard for the SSRF guard", err)
	}
}
