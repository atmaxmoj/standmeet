// http.go —— 各 adapter 共用的 HTTP helper：发请求 / 校状态码 / 解 JSON 或
// RSS / 设统一 User-Agent。任何一个 adapter 都不直接 net/http call。

package jobfetch

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
)

// getJSON GET url, 校 2xx, 解到 dst (caller 传 *T)。
func getJSON(
	ctx context.Context, client *http.Client, url string, dst any,
) error {
	body, err := doGET(ctx, client, url)
	if err != nil {
		return err
	}
	defer body.Close()
	if derr := json.NewDecoder(body).Decode(dst); derr != nil {
		return fmt.Errorf("%w: decode %s: %v", ErrUpstreamSchema, url, derr)
	}
	return nil
}

// getXML —— RSS feed 用。同 getJSON。
func getXML(
	ctx context.Context, client *http.Client, url string, dst any,
) error {
	body, err := doGET(ctx, client, url)
	if err != nil {
		return err
	}
	defer body.Close()
	if derr := xml.NewDecoder(body).Decode(dst); derr != nil {
		return fmt.Errorf("%w: decode rss %s: %v", ErrUpstreamSchema, url, derr)
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
		return nil, fmt.Errorf("%w: %s: %v", ErrUpstream, url, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("%w: %s: HTTP %d", ErrUpstream, url, resp.StatusCode)
	}
	return resp.Body, nil
}

// firstOrDefault —— base URL 选择：env 非空走 env，否则 fallback。
func firstOrDefault(envURL, fallback string) string {
	if envURL != "" {
		return envURL
	}
	return fallback
}
