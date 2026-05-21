// Package jobfetch —— job source fetcher adapters。每个 adapter 知道一个 ATS
// 或 job board 的具体 API 形状（URL pattern、JSON shape、字段映射），统一
// 输出 domain.FetchedJob 数组。
//
// 每个 adapter 的 base URL 从 env 覆写：production 不设 env，走 const 真 URL；
// e2e/dev 把 env 指向 docker compose 起的 job-board-mock 容器。
//
// 见 docs/design/job-loop.md "状态分工" 决策 L.1：StandMeet 不 reason job /
// 不打分 / 不排序——adapter 只把"今天这个源现在有哪些 job"原样输出。
package jobfetch

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

// Source kind strings —— 跟 schema CHECK 约束 + register_source 入参对齐。
const (
	KindGreenhouse      = "greenhouse"
	KindLever           = "lever"
	KindAshby           = "ashby"
	KindRemoteOK        = "remoteok"
	KindWWR             = "wwr"
	KindHNHiring        = "hn_hiring"
	KindSmartRecruiters = "smartrecruiters"
	KindWorkable        = "workable"
)

const (
	defaultHTTPTimeout = 20 * time.Second
	defaultUserAgent   = "StandMeet/0.1 (+https://github.com/wangsijie/standmeet)"
)

// Fetcher —— 单个 source kind 的契约。caller 拿 config（per-kind shape）
// 调一次，得到一批 jobs。adapter 内部负责 URL 拼装 / HTTP / parse。
type Fetcher interface {
	Fetch(ctx context.Context, cfg map[string]any) ([]domain.FetchedJob, error)
}

// Registry —— kind → Fetcher 的注册中心。usecases 拿这个 dispatch。
type Registry struct {
	fetchers map[string]Fetcher
}

// New 构造 Registry。BaseURLs 可单独设（e2e mock 时塞 fake server 地址），
// 任何 zero string 走 const 真 URL。
func New(b *BaseURLs) *Registry {
	if b == nil {
		b = &BaseURLs{}
	}
	client := &http.Client{Timeout: defaultHTTPTimeout}
	return &Registry{
		fetchers: map[string]Fetcher{
			KindGreenhouse:      newGreenhouseFetcher(client, b.Greenhouse),
			KindLever:           newLeverFetcher(client, b.Lever),
			KindAshby:           newAshbyFetcher(client, b.Ashby),
			KindRemoteOK:        newRemoteOKFetcher(client, b.RemoteOK),
			KindWWR:             newWWRFetcher(client, b.WWR),
			KindHNHiring:        newHNHiringFetcher(client, b.HN),
			KindSmartRecruiters: newSmartRecruitersFetcher(client, b.SmartRecruiters),
			KindWorkable:        newWorkableFetcher(client, b.Workable),
		},
	}
}

// BaseURLs —— 每个 adapter 的 base URL 覆写。任何空字符串走 const 真 URL。
// e2e 启动 backend 时通过 env 解到这里。
type BaseURLs struct {
	Greenhouse      string
	Lever           string
	Ashby           string
	RemoteOK        string
	WWR             string
	HN              string
	SmartRecruiters string
	Workable        string
}

// Fetch 按 kind 路由到对应 adapter。返 domain.ErrJobSourceKindInvalid 如果
// kind 不认识。
func (r *Registry) Fetch(
	ctx context.Context, kind string, cfg map[string]any,
) ([]domain.FetchedJob, error) {
	f, ok := r.fetchers[kind]
	if !ok {
		return nil, fmt.Errorf("fetch kind %q: %w", kind, domain.ErrJobSourceKindInvalid)
	}
	jobs, err := f.Fetch(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", kind, err)
	}
	return jobs, nil
}

// ValidateKindConfig —— 在 register_source 路径上校验 (kind, config) 形状。
// 拿不动 fetcher 实例就走基础规则（kind 在 enum、config 含必填 key）。
func ValidateKindConfig(kind string, cfg map[string]any) error {
	switch kind {
	case KindGreenhouse, KindLever, KindAshby, KindSmartRecruiters, KindWorkable:
		if _, ok := cfg["company"].(string); !ok {
			return fmt.Errorf(
				"%s needs config.company (string): %w",
				kind, domain.ErrJobSourceConfigInvalid,
			)
		}
		return nil
	case KindWWR:
		raw, ok := cfg["categories"]
		if !ok {
			return fmt.Errorf("wwr needs config.categories: %w", domain.ErrJobSourceConfigInvalid)
		}
		// JSON unmarshal gives []any; check non-empty
		arr, ok := raw.([]any)
		if !ok || len(arr) == 0 {
			return fmt.Errorf("wwr config.categories must be non-empty array: %w", domain.ErrJobSourceConfigInvalid)
		}
		return nil
	case KindRemoteOK, KindHNHiring:
		// 这俩 aggregate 源不需要 config
		return nil
	default:
		return fmt.Errorf("kind %q: %w", kind, domain.ErrJobSourceKindInvalid)
	}
}

// ErrUpstream —— adapter 收到非 2xx HTTP（含 404 / 5xx）。caller 可 errors.Is
// 区分"源死了"vs"配置错"。
var ErrUpstream = errors.New("upstream job board error")

// ErrUpstreamSchema —— 源回了 2xx 但 payload shape 不符（字段缺、JSON 解不开）。
// 通常是 fixture 漂移或源改 API 字段。
var ErrUpstreamSchema = errors.New("upstream schema mismatch")
