// Package gcal —— Google OAuth + Calendar v3 HTTP client. The single
// transport for "owner connects their calendar" + "agent books a meeting
// on owner's calendar" flows.
//
// Why a sidecar-shaped client: Google's libraries pull a lot of
// dependencies and the surface we need is small (3 endpoints). Thin HTTP
// against documented JSON contracts ports cleanly to the mock in
// cmd/job-board-mock without ifdef gymnastics.
//
// Endpoints come from env so e2e can point at the in-stack mock:
//
//	GOOGLE_AUTH_URL       —— consent-page base (prod:
//	                         accounts.google.com/o/oauth2/v2/auth)
//	GOOGLE_TOKEN_URL      —— token exchange endpoint (prod:
//	                         oauth2.googleapis.com/token)
//	GOOGLE_CALENDAR_BASE  —— calendar v3 base (prod:
//	                         www.googleapis.com/calendar/v3)
//
// Errors are typed (ErrInvalidGrant, ErrInsertConflict, ErrUnauthorized)
// so the BookMeeting usecase can branch on them and produce specific tool
// return shapes without parsing strings.
//
// File split (each ≤350 lines for max-lines lint):
//   - client.go  —— Client + Config + New + shared HTTP helpers
//   - oauth.go   —— BuildAuthCodeURL + ExchangeCode + RefreshToken
//   - events.go  —— FreeBusy + InsertEvent
package gcal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// ───── public errors ───────────────────────────────────────────

// ErrInvalidGrant —— OAuth refresh path returned invalid_grant (refresh
// token revoked / expired). Caller should mark the connector disconnected
// and surface "owner needs to re-authorize" to the visitor agent.
var ErrInvalidGrant = errors.New("gcal: oauth invalid_grant")

// ErrUnauthorized —— calendar API returned 401 / 403 (token expired or
// scope insufficient). Caller refreshes + retries; if still 401 → owner
// needs to re-authorize.
var ErrUnauthorized = errors.New("gcal: calendar unauthorized")

// ErrInsertConflict —— event insert collided with FreeBusy state. Google
// never actually returns this — we use FreeBusy + policy preflight before
// insert. Kept here so the surface mirrors BookMeeting's error vocab.
var ErrInsertConflict = errors.New("gcal: insert conflict")

// ───── client ────────────────────────────────────────────────────

// Client points at the OAuth + Calendar v3 HTTP API. Field order packs
// the GC-scannable pointer prefix (fieldalignment).
type Client struct {
	http            *http.Client
	authURL         string
	tokenURL        string
	calendarBase    string
	defaultRedirect string
}

// Config —— flag-style construction so wireup can pass env vars in one
// shot. Empty strings fall back to documented prod URLs.
type Config struct {
	AuthURL         string
	TokenURL        string
	CalendarBase    string
	DefaultRedirect string
	HTTPTimeout     time.Duration
}

// gosec G101 flags the word "token" — these are documented public Google
// endpoints, not credentials.
//
//nolint:gosec // G101 false positive: public OAuth endpoint URLs
const (
	prodAuthURL      = "https://accounts.google.com/o/oauth2/v2/auth"
	prodTokenURL     = "https://oauth2.googleapis.com/token"
	prodCalendarBase = "https://www.googleapis.com/calendar/v3"
	defaultTimeout   = 20 * time.Second
)

// New —— constructor. Empty config fields default to prod Google URLs.
func New(cfg Config) *Client {
	timeout := cfg.HTTPTimeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	return &Client{
		http:            &http.Client{Timeout: timeout},
		authURL:         orDefault(cfg.AuthURL, prodAuthURL),
		tokenURL:        orDefault(cfg.TokenURL, prodTokenURL),
		calendarBase:    orDefault(cfg.CalendarBase, prodCalendarBase),
		defaultRedirect: cfg.DefaultRedirect,
	}
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// ───── shared helpers ────────────────────────────────────────

const maxJSONBytes = 1 << 16 // 64 KiB — generous; Google bodies are small.

// calendarPost builds + sends a JSON POST to calendarBase+path with the
// bearer token. The caller is responsible for closing resp.Body.
func (c *Client) calendarPost(
	ctx context.Context, path, accessToken string, body []byte,
) (*http.Response, error) {
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, c.calendarBase+path, bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("gcal: new calendar request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, transportErr("calendar request", err)
	}
	return resp, nil
}

// calendarDelete builds + sends a DELETE to calendarBase+path with the
// bearer token. Body-less. Caller closes resp.Body.
func (c *Client) calendarDelete(
	ctx context.Context, path, accessToken string,
) (*http.Response, error) {
	req, err := http.NewRequestWithContext(
		ctx, http.MethodDelete, c.calendarBase+path, http.NoBody,
	)
	if err != nil {
		return nil, fmt.Errorf("gcal: new delete request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, transportErr("delete request", err)
	}
	return resp, nil
}

// checkCalendarStatus inspects the status code and returns ErrUnauthorized
// for 401/403, a wrapped error with body excerpt for other non-success
// codes, and nil for 200/201. Simple tagged switch — cyclop happy.
func checkCalendarStatus(resp *http.Response) error {
	switch resp.StatusCode {
	case http.StatusOK, http.StatusCreated:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrUnauthorized
	}
	return statusError(resp)
}

func statusError(resp *http.Response) error {
	excerpt, rerr := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes))
	if rerr != nil {
		return fmt.Errorf(
			"gcal: calendar status %d (body unreadable: %w)", resp.StatusCode, rerr,
		)
	}
	err := fmt.Errorf(
		"gcal: calendar status %d: %s",
		resp.StatusCode, strconv.Quote(string(excerpt)),
	)
	if transientStatus(resp.StatusCode) {
		return fmt.Errorf("%w: %w", err, ErrTransient)
	}
	return err
}

// Close-body pattern (callers): read response body → `resp.Body.Close()`
// → wrap the close error only when no prior error has already failed the
// call (see gotenberg.Client.RenderURL for the canonical shape). No
// deferred-close helper because errcheck (`check-blank: true`) won't
// accept `_, _ = io.Copy(...)` and bodyclose only recognizes a direct
// `resp.Body.Close()` call.
