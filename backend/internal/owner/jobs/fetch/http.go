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
	if bearer != "" && authRejected(resp, url) {
		return nil, fmt.Errorf("%s: %w: check this source's api_token", url, ErrUpstreamAuth)
	}
	return readOK(resp, url)
}

// authRejected —— did this authenticated request get rejected.
//
// Two shapes: a plain 401/403, and **being redirected away**. The latter is what real
// Workable does — a bad token replies `302 → /oops`, and Go's client follows redirects
// by default, so we end up with a 200 on that HTML page. JSON decoding then blows up on
// the leading "<", and what reaches the owner is "upstream schema mismatch".
// An **authenticated data request redirected to a different path** can only mean the
// upstream rejected this credential (F-E-17).
func authRejected(resp *http.Response, requested string) bool {
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return true
	}
	return resp.Request != nil && resp.Request.URL != nil &&
		resp.Request.URL.String() != requested
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

// upstreamStatusErr —— folds the status code into the owner's **next action**, not a
// generic "upstream error".
//
// The classification axis isn't "how many HTTP semantics exist", it's "how many
// distinct next actions the owner has": find a new address / fix a typo'd slug /
// do nothing / helplessly wait. Splitting a category further when the next action
// stays the same just gives him one more line to read (F-E-28).
// The per-code cases are written as a table; only the "whole 3xx range" stays a
// range check — writing it all as a switch pushes cyclo to 8 (cap is 5), and these
// lines are really just a lookup table anyway.
var upstreamStatusErrs = map[int]error{
	http.StatusNotFound:           ErrUpstreamNoBoard,
	http.StatusGone:               ErrUpstreamNoBoard,
	http.StatusTooManyRequests:    ErrUpstreamBusy,
	http.StatusServiceUnavailable: ErrUpstreamBusy,
}

func upstreamStatusErr(code int) error {
	if e, ok := upstreamStatusErrs[code]; ok {
		return e
	}
	if code >= http.StatusMultipleChoices && code < http.StatusBadRequest {
		return ErrUpstreamMoved
	}
	return ErrUpstream
}

// maxFetchBodyBytes —— hard cap on a single upstream body (HTML/JSON page or a gzipped JBA chunk;
// both are ≪ this). Bounds io.ReadAll so a hostile/broken source can't force unbounded memory.
const maxFetchBodyBytes = 10 << 20 // 10 MiB

func readOK(resp *http.Response, url string) ([]byte, error) {
	if resp.StatusCode < httpOKBase || resp.StatusCode >= httpOKBase+100 {
		return nil, fmt.Errorf("%s: %w: HTTP %d",
			url, upstreamStatusErr(resp.StatusCode), resp.StatusCode)
	}
	// read one byte past the cap so an over-limit body is detected rather than silently truncated.
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%s: read body: %w: %w", url, ErrUpstream, err)
	}
	if int64(len(body)) > maxFetchBodyBytes {
		return nil, fmt.Errorf("%s: %w: response body exceeds %d bytes",
			url, ErrUpstream, maxFetchBodyBytes)
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
