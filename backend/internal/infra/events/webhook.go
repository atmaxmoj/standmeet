// webhook.go — one event to one webhook endpoint, in the Standard Webhooks wire format
// (docs/design/event-bus-outbox-webhooks.md, *Relay and delivery*, *Retry*).
//
// The payload is thin: {id, type, subject, occurred_at, data}. The headers are webhook-id (the
// event id, so a retry carries the same id and the receiver dedupes on it), webhook-timestamp and
// webhook-signature: v1,<base64 HMAC-SHA256(key, id.ts.body)>, key = the base64 after "whsec_".
//
// Retry has one owner, the job layer. Delivery only classifies the outcome:
//   - 2xx                                  → nil (completed)
//   - 429 / 503 with Retry-After           → jobs.Snooze (no attempt spent)
//   - 408 / 429 / 5xx, timeouts, conn errs → a plain error (retryable, on WebhookBackoff)
//   - any other 4xx, an SSRF-blocked URL   → jobs.Discard (retrying only hammers the receiver)
//
// Endpoints are a domain's data; this file sees only a URL, a secret and the event.

package events

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

// Webhook delivery limits.
const (
	// WebhookSecretPrefix — the Standard Webhooks secret prefix.
	WebhookSecretPrefix = "whsec_"
	// WebhookTimeout — the delivery job's hard limit per attempt; the HTTP timeout is shorter, so
	// a clear network error arrives first.
	WebhookTimeout = 15 * time.Second
	// WebhookMaxAttempts — the schedule below reaches about 5 days at this many attempts.
	WebhookMaxAttempts = 18
	webhookHTTPTimeout = 10 * time.Second
	webhookSecretBytes = 32
	webhookSnoozeCap   = 10 * time.Hour
	webhookDrainLimit  = 64 << 10
	decimal            = 10
)

// webhookSchedule — Svix: 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, then 10 h steps.
var webhookSchedule = [...]time.Duration{
	5 * time.Second, 5 * time.Minute, 30 * time.Minute,
	2 * time.Hour, 5 * time.Hour, 10 * time.Hour,
}

// WebhookBackoff — the wait after failed attempt n (from 1).
func WebhookBackoff(attempt int) time.Duration {
	return webhookSchedule[min(max(attempt, 1), len(webhookSchedule))-1]
}

// NewWebhookSecret — "whsec_" + base64 of 32 random bytes.
func NewWebhookSecret() (string, error) {
	key := make([]byte, webhookSecretBytes)
	if _, err := rand.Read(key); err != nil {
		return "", fmt.Errorf("webhook secret: %w", err)
	}
	return WebhookSecretPrefix + base64.StdEncoding.EncodeToString(key), nil
}

// SignWebhook — "v1,<base64 HMAC-SHA256(key, id.ts.body)>".
func SignWebhook(secret, id string, ts int64, body []byte) (string, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, WebhookSecretPrefix))
	if err != nil || len(key) == 0 {
		return "", errors.New("webhook secret is not whsec_<base64>")
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + strconv.FormatInt(ts, decimal) + "."))
	mac.Write(body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil)), nil
}

// webhookBody — the thin payload, field order fixed.
type webhookBody struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Subject    string          `json:"subject"`
	OccurredAt time.Time       `json:"occurred_at"`
	Data       json.RawMessage `json:"data"`
}

// WebhookPayload — the compact JSON body for ev.
func WebhookPayload(ev *Event) ([]byte, error) {
	data := ev.Data
	if len(data) == 0 {
		data = json.RawMessage("{}")
	}
	b, err := json.Marshal(webhookBody{
		ID: ev.ID, Type: ev.Type, Subject: ev.Subject, OccurredAt: ev.OccurredAt.UTC(), Data: data,
	})
	if err != nil {
		return nil, fmt.Errorf("webhook payload: %w", err)
	}
	return b, nil
}

// NewWebhookClient — the one client deliveries use: SSRF-guarded, no transport retry (the job
// layer owns retries), shorter than the job timeout.
func NewWebhookClient() *http.Client {
	return httpx.NewClient(httpx.Options{
		Timeout: webhookHTTPTimeout, NoRetry: true, BlockInternalEgress: true,
	})
}

// DeliverWebhook — posts ev to url, signed with secret, and classifies the outcome.
func DeliverWebhook(
	ctx context.Context, client *http.Client, url, secret string, ev *Event,
) error {
	req, err := signedRequest(ctx, url, secret, ev)
	if err != nil {
		return jobs.Discard(err)
	}
	resp, err := client.Do(req)
	if resp != nil {
		drain(resp)
	}
	return ClassifyWebhook(resp, err)
}

// signedRequest — the POST with the payload and the three Standard Webhooks headers.
func signedRequest(ctx context.Context, url, secret string, ev *Event) (*http.Request, error) {
	body, err := WebhookPayload(ev)
	if err != nil {
		return nil, err
	}
	ts := time.Now().Unix()
	sig, err := SignWebhook(secret, ev.ID, ts, body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Webhook-Id", ev.ID)
	req.Header.Set("Webhook-Timestamp", strconv.FormatInt(ts, decimal))
	req.Header.Set("Webhook-Signature", sig)
	return req, nil
}

// drain — reads a little of the answer and closes it, so the connection can be reused.
// The status already decided the outcome, so a failure here only costs the connection: log it.
func drain(resp *http.Response) {
	_, cerr := io.Copy(io.Discard, io.LimitReader(resp.Body, webhookDrainLimit))
	if err := errors.Join(cerr, resp.Body.Close()); err != nil {
		slog.Debug("webhook: drain response", "err", err)
	}
}

// ClassifyWebhook — the failure class of one delivery attempt (see the file comment).
func ClassifyWebhook(resp *http.Response, err error) error {
	if err != nil {
		return classifyTransport(err)
	}
	return classifyStatus(resp)
}

func classifyTransport(err error) error {
	if errors.Is(err, httpx.ErrBlockedEgress) {
		return jobs.Discard(err)
	}
	return fmt.Errorf("webhook delivery: %w", err)
}

func classifyStatus(resp *http.Response) error {
	code := resp.StatusCode
	if succeeded(code) {
		return nil
	}
	answered := fmt.Errorf("webhook endpoint answered %d", code)
	if d, ok := askedToWait(resp); ok {
		return jobs.Snooze(d)
	}
	if permanent(code) {
		return jobs.Discard(answered)
	}
	return answered
}

func succeeded(code int) bool {
	return code >= http.StatusOK && code < http.StatusMultipleChoices
}

// askedToWait — a 429 or 503 that says when to come back.
func askedToWait(resp *http.Response) (time.Duration, bool) {
	if resp.StatusCode != http.StatusTooManyRequests &&
		resp.StatusCode != http.StatusServiceUnavailable {
		return 0, false
	}
	d := httpx.RetryAfter(resp)
	return min(d, webhookSnoozeCap), d > 0
}

// permanent — a 4xx other than 408 and 429: retrying would not help.
func permanent(code int) bool {
	return code >= http.StatusBadRequest && code < http.StatusInternalServerError &&
		code != http.StatusRequestTimeout && code != http.StatusTooManyRequests
}
