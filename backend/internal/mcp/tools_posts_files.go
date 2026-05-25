// tools_posts_files.go —— MCP post_create / post_update 的 `files` array
// param 解析：每条 {pending_id, url}，server 用 https GET 拉 bytes (image/*
// only) 转 usecases.FileInput。AI 不需要 base64 inline，节省 context token；
// 形态对齐 obsidian-web-clipper（owner 把图 URL 给 clipper，clipper 抓回
// vault）的约定。
//
// SSRF 防御 MVP：
//   - scheme = https only (no file:// / http:// / data://)
//   - Content-Type 必须 image/*
//   - body 最大 10MB
//
// 后续可加：private IP block 列表 (10/172.16-31/192.168/127/::1)、host
// allowlist。

package mcp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/wangsijie/standmeet/internal/usecases"
)

const (
	mcpFileMaxBytes     = 10 << 20 // 10MB
	mcpFileFetchTimeout = 15 * time.Second
)

// resolveMCPFiles —— 解 tool args 的 `files` 数组 → 按 URL 拉 bytes →
// 返 []FileInput 给 SavePost。任一失败 → 整批 fail（atomic）。
func resolveMCPFiles(ctx context.Context, raw any) ([]usecases.FileInput, error) {
	arr, ok := raw.([]any)
	if !ok {
		return nil, errors.New("files: must be array")
	}
	out := make([]usecases.FileInput, 0, len(arr))
	for i, item := range arr {
		fi, ferr := fetchOneFileItem(ctx, i, item)
		if ferr != nil {
			return nil, ferr
		}
		out = append(out, fi)
	}
	return out, nil
}

func fetchOneFileItem(ctx context.Context, idx int, item any) (usecases.FileInput, error) {
	m, ok := item.(map[string]any)
	if !ok {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: must be object", idx)
	}
	pending, perr := mustStringField(m, "pending_id", idx)
	if perr != nil {
		return usecases.FileInput{}, perr
	}
	rawURL, uerr := mustStringField(m, "url", idx)
	if uerr != nil {
		return usecases.FileInput{}, uerr
	}
	if verr := validateFileURL(rawURL); verr != nil {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: %w", idx, verr)
	}
	return doFetch(ctx, pending, rawURL, idx)
}

func mustStringField(m map[string]any, key string, idx int) (string, error) {
	v, ok := m[key].(string)
	if !ok || v == "" {
		return "", fmt.Errorf("files[%d]: %s is required string", idx, key)
	}
	return v, nil
}

func validateFileURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if u.Scheme != "https" {
		return errors.New("only https URLs allowed")
	}
	return nil
}

func doFetch(
	ctx context.Context, pendingID, rawURL string, idx int,
) (usecases.FileInput, error) {
	client := &http.Client{Timeout: mcpFileFetchTimeout}
	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if rerr != nil {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: build req: %w", idx, rerr)
	}
	resp, herr := client.Do(req)
	if herr != nil {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: fetch: %w", idx, herr)
	}
	defer closeRespBestEffort(resp.Body)
	return readFetchedFile(resp, pendingID, idx)
}

func closeRespBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

func readFetchedFile(
	resp *http.Response, pendingID string, idx int,
) (usecases.FileInput, error) {
	if resp.StatusCode != http.StatusOK {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: status %d", idx, resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image/") {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: content-type %s (must be image/*)", idx, ct)
	}
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, mcpFileMaxBytes+1))
	if rerr != nil {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: read body: %w", idx, rerr)
	}
	if int64(len(body)) > mcpFileMaxBytes {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: body exceeds %d bytes", idx, mcpFileMaxBytes)
	}
	return usecases.FileInput{
		PendingID: pendingID, ContentType: ct,
		OriginalFilename: lastURLSegment(resp.Request.URL.Path),
		Body:             body,
	}, nil
}

func lastURLSegment(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}
