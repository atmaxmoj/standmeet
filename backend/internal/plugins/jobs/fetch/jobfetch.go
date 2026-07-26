// Package fetch —— job source fetcher adapters。每个 adapter 知道一个 ATS
// 或 job board 的具体 API 形状（URL pattern、JSON shape、字段映射），统一
// 输出 jobsdomain.FetchedJob 数组。
//
// J phase 起搬进 plugins/jobs/fetch/，作为 jobs plugin 的 fetch sub-package。
//
// 每个 adapter 的 base URL 从 env 覆写：production 不设 env，走 const 真 URL；
// e2e/dev 把 env 指向 docker compose 起的 external-mock 容器。
//
// 见 docs/design/job-loop.md "状态分工" 决策 L.1：StandMeet 不 reason job /
// 不打分 / 不排序——adapter 只把"今天这个源现在有哪些 job"原样输出。
//
// **Config 形状**：register_source 传上来是 schemaless object；写 DB 时
// marshal 成 JSON bytes；fetcher 收到 []byte，第一行就 Unmarshal 到自己的
// typed struct。这样 domain / fetch 边界都不沾 `any`。
package fetch

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/httpx"
	"github.com/atmaxmoj/standmeet/internal/jobsdomain"
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
	// KindJBA —— J.6a: JobBoardAggregator (Feashliaa) 聚合源；详见 jba.go。
	KindJBA = "jba"
	// KindWorkday / KindBambooHR —— J.6b: 两个直 ATS adapter (跟 greenhouse
	// 同 strategy)；不依赖 JBA。
	KindWorkday  = "workday"
	KindBambooHR = "bamboohr"
)

const (
	defaultHTTPTimeout = 20 * time.Second
	defaultUserAgent   = "StandMeet/0.1 (+https://github.com/atmaxmoj/standmeet)"
	// defaultTagCap —— common starting capacity for per-job tag slices
	// (most adapters emit 3-4 tags; pre-sizing keeps append() amortised).
	defaultTagCap = 4
	// decimalRadix —— strconv.FormatInt base 10. Named so revive add-constant
	// stops complaining and the call sites read with intent.
	decimalRadix = 10
)

// Fetcher —— 单个 source kind 的契约。caller 传 raw config bytes（per-kind
// schema），adapter 内部 Unmarshal 到 typed struct + 拼 URL + GET + parse。
type Fetcher interface {
	Fetch(ctx context.Context, cfgRaw []byte) ([]jobsdomain.FetchedJob, error)
}

// Registry —— kind → Fetcher 的注册中心。usecases 拿这个 dispatch。
type Registry struct {
	fetchers map[string]Fetcher
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
	JBA             string
	Workday         string
	BambooHR        string
}

// New 构造 Registry。BaseURLs 可单独设（e2e mock 时塞 fake server 地址），
// 任何 zero string 走 const 真 URL。
func New(b *BaseURLs) *Registry {
	if b == nil {
		b = &BaseURLs{}
	}
	client := httpx.NewClient(httpx.Options{Timeout: defaultHTTPTimeout})
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
			KindJBA:             newJBAFetcher(client, b.JBA),
			KindWorkday:         newWorkdayFetcher(client, b.Workday),
			KindBambooHR:        newBambooHRFetcher(client, b.BambooHR),
		},
	}
}

// Fetch 按 kind 路由到对应 adapter。返 jobsdomain.ErrJobSourceKindInvalid 如果
// kind 不认识。
func (r *Registry) Fetch(
	ctx context.Context, kind string, cfgRaw []byte,
) ([]jobsdomain.FetchedJob, error) {
	f, ok := r.fetchers[kind]
	if !ok {
		return nil, fmt.Errorf("fetch kind %q: %w", kind, jobsdomain.ErrJobSourceKindInvalid)
	}
	jobs, err := f.Fetch(ctx, cfgRaw)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", kind, err)
	}
	return jobs, nil
}

// ValidateKindConfig —— 在 register_source 路径上校验 (kind, config) 形状：
// kind 是否在 enum + config JSON 解到 per-kind 类型 + 必填字段非空。
func ValidateKindConfig(kind string, cfgRaw []byte) error {
	v, ok := configValidators[kind]
	if !ok {
		return fmt.Errorf("kind %q: %w", kind, jobsdomain.ErrJobSourceKindInvalid)
	}
	if err := v(cfgRaw); err != nil {
		return fmt.Errorf("%s config: %w", kind, err)
	}
	return nil
}

// configValidators 是 kind → cfg-shape-check 的 dispatch 表。每个 entry
// 复用 adapter 自己的 typed config struct，保持唯一真理源。
var configValidators = map[string]func([]byte) error{
	KindGreenhouse:      validateGreenhouseCfg,
	KindLever:           validateLeverCfg,
	KindAshby:           validateAshbyCfg,
	KindSmartRecruiters: validateSmartRecruitersCfg,
	KindWorkable:        validateWorkableCfg,
	KindWWR:             validateWWRCfg,
	KindRemoteOK:        validateEmptyCfg,
	KindHNHiring:        validateEmptyCfg,
	KindJBA:             validateJBACfg,
	KindWorkday:         validateWorkdayCfg,
	KindBambooHR:        validateBambooHRCfg,
}

// validateEmptyCfg —— remoteok / hn_hiring 不需要任何 config，传啥都接受。
func validateEmptyCfg(_ []byte) error { return nil }

// ErrUpstream —— adapter 收到非 2xx HTTP（含 404 / 5xx）。caller 可 errors.Is
// 区分"源死了"vs"配置错"。
var ErrUpstream = errors.New("upstream job board error")

// ErrUpstreamSchema —— 源回了 2xx 但 payload shape 不符（字段缺、JSON 解不开）。
// 通常是 fixture 漂移或源改 API 字段。
var ErrUpstreamSchema = errors.New("upstream schema mismatch")
