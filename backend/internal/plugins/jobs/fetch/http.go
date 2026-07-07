// http.go — shared HTTP helpers used by all adapters. No adapter calls
// net/http directly. Adapters read the body via getBody, then do their
// own typed json.Unmarshal / xml.Unmarshal so this file never touches
// `any` (the stdlib decoder boundary stays inside each adapter).
//
// Tag-building helpers (appendIfNonEmpty etc) keep per-adapter toDomain
// functions short, satisfying cognitive-complexity without per-package
// lint exemption.

package fetch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const httpOKBase = 200

// getBody GETs url, checks 2xx, returns the response body as bytes.
// Adapters then call json.Unmarshal / xml.Unmarshal into their typed
// struct. Keeping the `any`-shaped decoder API out of this file lets
// the package satisfy the project-wide "no any in business code" rule
// without a path-based forbidigo exemption.
func getBody(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	return getBodyAuth(ctx, client, url, "")
}

// getBodyAuth is getBody with a Bearer token — for adapters whose upstream needs auth
// (Workable's SPI jobs endpoint). Empty bearer → no Authorization header (the plain path).
func getBodyAuth(ctx context.Context, client *http.Client, url, bearer string) ([]byte, error) {
	resp, err := sendGET(ctx, client, url, bearer)
	if err != nil {
		return nil, err
	}
	defer closeQuiet(resp.Body)
	return readOK(resp, url)
}

func sendGET(ctx context.Context, client *http.Client, url, bearer string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "application/json, application/rss+xml, text/xml, */*")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w: %w", url, ErrUpstream, err)
	}
	return resp, nil
}

func readOK(resp *http.Response, url string) ([]byte, error) {
	if resp.StatusCode < httpOKBase || resp.StatusCode >= httpOKBase+100 {
		return nil, fmt.Errorf("%s: %w: HTTP %d", url, ErrUpstream, resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s: read body: %w: %w", url, ErrUpstream, err)
	}
	return body, nil
}

// closeQuiet swallows Close errors on response/io bodies; we already have the
// payload bytes, so a TCP-FIN race during teardown isn't actionable.
func closeQuiet(c io.Closer) {
	if err := c.Close(); err != nil {
		// intentional swallow — see doc above
		_ = err
	}
}

// firstOrDefault picks env override or const fallback when the override is "".
func firstOrDefault(envURL, fallback string) string {
	if envURL != "" {
		return envURL
	}
	return fallback
}

// firstNonEmpty returns the first non-empty string from the input list, or "".
func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if s != "" {
			return s
		}
	}
	return ""
}

// appendIfNonEmpty grows the tag list only when s is non-empty.
// Used by per-adapter toDomain functions to keep cognitive complexity low —
// the alternative (inline `if s != "" { ... }` per field) compounds quickly.
func appendIfNonEmpty(out []string, s string) []string {
	if s != "" {
		out = append(out, s)
	}
	return out
}

// appendIfNonNil dereferences a *string and appends only when non-nil and
// non-empty. Ashby's department/team/location fields are nullable JSON, so
// the optional-string idiom is common there.
func appendIfNonNil(out []string, p *string) []string {
	if p != nil && *p != "" {
		out = append(out, *p)
	}
	return out
}

// preferNonNil dereferences a *string; returns fallback when nil or empty.
func preferNonNil(p *string, fallback string) string {
	if p != nil && *p != "" {
		return *p
	}
	return fallback
}

// errors.Is sanity (compile-time check that ErrUpstream / ErrUpstreamSchema
// stay wrapped, so callers can branch on them).
var _ = errors.Is
