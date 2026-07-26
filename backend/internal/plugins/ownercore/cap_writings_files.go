// cap_writings_files.go —— writing_create inline image fetch helper。
// 前身 tools_writings_files.go 走 GetArguments() map[string]any 解析；
// 新路径走 json.Unmarshal 进 writingFileWire 直接。SSRF 防御同：
//   - scheme = https only
//   - Content-Type 必须 image/*
//   - body 最大 10MB
//
// 后续可加：private IP block 列表 / host allowlist。

package ownercore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus"

	"github.com/atmaxmoj/standmeet/internal/httpx"
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
) ([]corpus.FileInput, error) {
	if len(files) == 0 {
		return []corpus.FileInput{}, nil
	}
	out := make([]corpus.FileInput, 0, len(files))
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
) (corpus.FileInput, error) {
	if f.PendingID == "" {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: pending_id is required", idx)
	}
	if f.URL == "" {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: url is required", idx)
	}
	if verr := validateInlineFileURL(f.URL); verr != nil {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: %w", idx, verr)
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
) (corpus.FileInput, error) {
	// BlockInternalEgress —— owner-supplied URL, no allow-list: the fetch must not reach internal
	// addresses (metadata endpoint / internal services). The https-only check above is not enough
	// (a public-looking host can resolve/redirect to an internal IP).
	client := httpx.NewClient(httpx.Options{
		Timeout: capFileFetchTimeout, BlockInternalEgress: true,
	})
	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if rerr != nil {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: build req: %w", idx, rerr)
	}
	resp, herr := client.Do(req)
	if herr != nil {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: fetch: %w", idx, herr)
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
) (corpus.FileInput, error) {
	if resp.StatusCode != http.StatusOK {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: status %d", idx, resp.StatusCode)
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "image/") {
		return corpus.FileInput{},
			fmt.Errorf("files[%d]: content-type %s (must be image/*)", idx, ct)
	}
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, capFileMaxBytes+1))
	if rerr != nil {
		return corpus.FileInput{}, fmt.Errorf("files[%d]: read body: %w", idx, rerr)
	}
	if int64(len(body)) > capFileMaxBytes {
		return corpus.FileInput{},
			fmt.Errorf("files[%d]: body exceeds %d bytes", idx, capFileMaxBytes)
	}
	return corpus.FileInput{
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
