// validate.go —— #155 区 A：spec 摄入校验编排。admin UI 贴/传/URL 拉一份 OpenAPI spec → 这里
// （URL 则先 fetch）跑 openapi.ValidateIngest → 回候选标题或人类可读拒绝理由。复用同一个 3.0
// parser（归一），不在前端重写 YAML/校验。

package connectorsvc

import (
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// specFetchReason —— URL 拉取失败的 owner 友好文案（不漏底层）。
const specFetchReason = "could not fetch the spec from that URL (is it reachable?)"

// AuthForms —— 派生凭据表单（别名透传，让 adminroutes 经 connectorsvc 用，不直接 import connector）。
type AuthForms = connector.AuthForms

// SpecVerdict —— 摄入校验结果：OK → Title（候选标题）+ 派生凭据表单；否则 Reason（拒绝理由）。
type SpecVerdict struct {
	Title  string
	Reason string
	Auth   connector.AuthForms
	OK     bool
}

// ValidateSpec —— 校验一份待摄入 spec。url 非空则先 fetch（限长）。结果是 owner 友好 verdict
// （坏版本 / 缺 servers / operationId 问题 / 外部 $ref / 过大 / 拉取失败 → Reason）。
func (s *Service) ValidateSpec(ctx context.Context, spec []byte, url string) SpecVerdict {
	raw := spec
	if url != "" {
		fetched, ferr := s.fetchSpec(ctx, url)
		if ferr != nil {
			return SpecVerdict{Reason: specFetchReason}
		}
		raw = fetched
	}
	v := connector.ValidateIngestSpec(raw)
	return SpecVerdict{OK: v.OK, Title: v.Title, Reason: v.Reason, Auth: v.Auth}
}

// fetchSpec —— 从 URL 拉 spec 文本（限长 + 非 2xx 视为失败）。owner-only；任何失败统一回 ErrSpecFetch。
func (s *Service) fetchSpec(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("build spec fetch request: %w", err)
	}
	resp, derr := s.d.HTTP.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("fetch spec: %w", derr)
	}
	return readSpecResponse(resp)
}

// readSpecResponse —— 读响应体（限长）+ 关体 + 非 2xx 视为失败。
func readSpecResponse(resp *http.Response) ([]byte, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, connector.MaxSpecBytes))
	if cerr := resp.Body.Close(); cerr != nil && rerr == nil {
		rerr = cerr
	}
	if rerr != nil {
		return nil, fmt.Errorf("read fetched spec: %w", rerr)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("fetch spec: status %d", resp.StatusCode)
	}
	return raw, nil
}
