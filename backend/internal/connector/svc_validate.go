// validate.go —— #155 区 A：spec 摄入校验编排。admin UI 贴/传/URL 拉一份 OpenAPI spec → 这里
// （URL 则先 fetch）跑 openapi.ValidateIngest → 回候选标题或人类可读拒绝理由。复用同一个 3.0
// parser（归一），不在前端重写 YAML/校验。

package connector

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// specFetchReason —— URL 拉取失败的 owner 友好文案（不漏底层）。
const specFetchReason = "could not fetch the spec from that URL (is it reachable?)"

// specBlockedReason —— 被出站守卫按**策略**挡下的那一种。必须跟上面那句分开:那个地址往往
// 完完全全可达(F-C-23 就是拿同一 docker 网络上、wget 拿得到 200 的地址驱出来的),
// 「是不是连不上?」会把 owner 支去排查自己的网络,而真相是这台实例不允许指向内网。
// 同一个代码库里 inference_models.go 早就这么分了,这里只是补上同一刀。
const specBlockedReason = "that URL points at an internal/private address, " +
	"which this instance does not allow"

// fetchReason —— 把拉取失败翻成给 owner 的那句话。只有**真的**是内网目标才说地址策略:
// 解析不了的域名走原来那句(它说的是实话),否则就是把谎换个方向。
func fetchReason(err error) string {
	if errors.Is(err, ErrBlockedEgress) {
		return specBlockedReason
	}
	return specFetchReason
}

// AuthForms —— 派生凭据表单（别名透传，让 adminroutes 经 connectorsvc 用，不直接 import connector）。

// SpecVerdict —— 摄入校验结果：OK → Title（候选标题）+ 派生凭据表单；否则 Reason（拒绝理由）。
type SpecVerdict struct {
	Title  string
	Reason string
	Auth   AuthForms
	OK     bool
}

// specBaseURLReason —— owner 填的 base URL 并不进这份文档时说的话。
const specBaseURLReason = "could not apply that base URL to the spec " +
	"(is the document an OpenAPI object?)"

// ValidateSpec —— 校验一份待摄入 spec。url 非空则先 fetch（限长）；baseURL 非空则先并进
// `servers`（F-C-22：真厂商文档常常不带 servers，而 owner 不该去手改 vendor 的文件）。
// 结果是 owner 友好 verdict（坏版本 / 缺 servers / operationId 问题 / 外部 $ref / 过大 /
// 拉取失败 → Reason）。
//
// baseURL 为空时这里**一个字节都不改**，所以「没填 base URL 的 spec 仍然因缺 servers 被拒」
// 这条老行为原样保留 —— 补上才放行，不是从此不查。
func (s *Service) ValidateSpec(
	ctx context.Context, spec []byte, url, baseURL string,
) SpecVerdict {
	raw := spec
	if url != "" {
		fetched, ferr := s.fetchSpec(ctx, url)
		if ferr != nil {
			return SpecVerdict{Reason: fetchReason(ferr)}
		}
		raw = fetched
	}
	normalized, aerr := openapi.ApplyBaseURL(raw, baseURL)
	if aerr != nil {
		return SpecVerdict{Reason: specBaseURLReason}
	}
	v := ValidateIngestSpec(normalized)
	return SpecVerdict(v)
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
//
// **多读一个字节，就为了分得清「太大」和「写坏了」**（F-C-52）。读到正好 `MaxSpecBytes` 时，
// 下游那句 `len(raw) > MaxSpecBytes` 永不成立，于是一份**合法但过大**的文档在截断处解析失败，
// 产品对 owner 说的是「invalid JSON or YAML」—— 他会去找一个不存在的语法错误。
// 真世界里这不是边角：GitHub 自己发布的 `api.github.com.json` 是 12 MB。
// 粘贴那条路一直说得对（`ValidateIngest` 先量长度），是这条抓取的路够不着同一句话。
func readSpecResponse(resp *http.Response) ([]byte, error) {
	raw, rerr := io.ReadAll(io.LimitReader(resp.Body, int64(MaxSpecBytes)+1))
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
