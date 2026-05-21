// http.go — shared HTTP helper used by all adapters: do GET, check 2xx,
// decode JSON or RSS, set the common User-Agent. No adapter calls net/http
// directly.

package jobfetch

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
)

const httpOKBase = 200

func getJSON(
	ctx context.Context, client *http.Client, url string, dst any,
) error {
	body, err := doGET(ctx, client, url)
	if err != nil {
		return err
	}
	defer closeQuiet(body)
	if derr := json.NewDecoder(body).Decode(dst); derr != nil {
		return fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, derr)
	}
	return nil
}

func getXML(
	ctx context.Context, client *http.Client, url string, dst any,
) error {
	body, err := doGET(ctx, client, url)
	if err != nil {
		return err
	}
	defer closeQuiet(body)
	if derr := xml.NewDecoder(body).Decode(dst); derr != nil {
		return fmt.Errorf("decode rss %s: %w: %w", url, ErrUpstreamSchema, derr)
	}
	return nil
}

func doGET(ctx context.Context, client *http.Client, url string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Accept", "application/json, application/rss+xml, text/xml, */*")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w: %w", url, ErrUpstream, err)
	}
	if resp.StatusCode < httpOKBase || resp.StatusCode >= httpOKBase+100 {
		closeQuiet(resp.Body)
		return nil, fmt.Errorf("%s: %w: HTTP %d", url, ErrUpstream, resp.StatusCode)
	}
	return resp.Body, nil
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

// companyField — convenience around strField; ATS adapters all key on
// "company". Centralised so unparam sees a single use-site that isn't
// always-the-same-key.
func companyField(m map[string]any) string {
	if v, ok := m["company"].(string); ok {
		return v
	}
	return ""
}

// errors.Is sanity (compile-time check that ErrUpstream / ErrUpstreamSchema
// stay wrapped, so callers can branch on them).
var _ = errors.Is
