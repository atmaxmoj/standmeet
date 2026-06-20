// cap_writings_files.go —— writing_create inline image fetch helper。
// 前身 tools_writings_files.go 走 GetArguments() map[string]any 解析；
// 新路径走 json.Unmarshal 进 writingFileWire 直接。SSRF 防御同：
//   - scheme = https only
//   - Content-Type 必须 image/*
//   - body 最大 10MB
//
// 后续可加：private IP block 列表 / host allowlist。

package mcphandle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const (
	capFileMaxBytes     = 10 << 20 // 10MB
	capFileFetchTimeout = 15 * time.Second
)

type writingFileWire struct {
	PendingID string `json:"pending_id"`
	URL       string `json:"url"`
}

// fetchInlineFiles —— writing_create 的 files 数组按 URL 拉 bytes →
// 返 []FileInput 给 SaveWriting。任一失败 → 整批 fail (atomic)。
func fetchInlineFiles(
	ctx context.Context, files []writingFileWire,
) ([]usecases.FileInput, error) {
	if len(files) == 0 {
		return []usecases.FileInput{}, nil
	}
	out := make([]usecases.FileInput, 0, len(files))
	for i := range files {
		fi, ferr := fetchOneInlineFile(ctx, i, &files[i])
		if ferr != nil {
			return nil, ferr
		}
		out = append(out, fi)
	}
	return out, nil
}

func fetchOneInlineFile(
	ctx context.Context, idx int, f *writingFileWire,
) (usecases.FileInput, error) {
	if f.PendingID == "" {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: pending_id is required", idx)
	}
	if f.URL == "" {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: url is required", idx)
	}
	if verr := validateInlineFileURL(f.URL); verr != nil {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: %w", idx, verr)
	}
	return doInlineFileFetch(ctx, f.PendingID, f.URL, idx)
}

func validateInlineFileURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if u.Scheme != "https" {
		return errors.New("only https URLs allowed")
	}
	return nil
}

func doInlineFileFetch(
	ctx context.Context, pendingID, rawURL string, idx int,
) (usecases.FileInput, error) {
	client := &http.Client{Timeout: capFileFetchTimeout}
	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if rerr != nil {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: build req: %w", idx, rerr)
	}
	resp, herr := client.Do(req)
	if herr != nil {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: fetch: %w", idx, herr)
	}
	defer closeInlineRespBestEffort(resp.Body)
	return readInlineFetched(resp, pendingID, idx)
}

func closeInlineRespBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

func readInlineFetched(
	resp *http.Response, pendingID string, idx int,
) (usecases.FileInput, error) {
	if resp.StatusCode != http.StatusOK {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: status %d", idx, resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image/") {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: content-type %s (must be image/*)", idx, ct)
	}
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, capFileMaxBytes+1))
	if rerr != nil {
		return usecases.FileInput{}, fmt.Errorf("files[%d]: read body: %w", idx, rerr)
	}
	if int64(len(body)) > capFileMaxBytes {
		return usecases.FileInput{},
			fmt.Errorf("files[%d]: body exceeds %d bytes", idx, capFileMaxBytes)
	}
	return usecases.FileInput{
		PendingID: pendingID, ContentType: ct,
		OriginalFilename: lastInlineURLSegment(resp.Request.URL.Path),
		Body:             body,
	}, nil
}

func lastInlineURLSegment(path string) string {
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}
