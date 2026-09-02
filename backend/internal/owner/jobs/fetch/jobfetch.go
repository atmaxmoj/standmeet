// Package fetch —— job source fetcher adapters。每个 adapter 知道一个 ATS
// 或 job board 的具体 API 形状（URL pattern、JSON shape、字段映射），统一
// 输出 jobsmodel.FetchedJob 数组。
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
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/plaintext"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
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
	// KindJobicy / KindRemotive / KindHimalayas / KindWorkingNomads — remote-jobs
	// aggregators (single public feed, no per-source config).
	KindJobicy        = "jobicy"
	KindRemotive      = "remotive"
	KindHimalayas     = "himalayas"
	KindWorkingNomads = "working_nomads"
	// KindRecruitee — per-company ATS (public Careers Site API), like greenhouse.
	KindRecruitee = "recruitee"
	// KindJobPostingJSONLD — generic long-tail ingester: parses schema.org
	// JobPosting JSON-LD off detail pages (config carries a sitemap or urls).
	KindJobPostingJSONLD = "jobposting_jsonld"
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
	Fetch(ctx context.Context, cfgRaw []byte) ([]jobsmodel.FetchedJob, error)
}

// Accountant —— **可选**实现：交代这一趟 adapter 自己内部做了什么取舍。
//
// 为什么是可选的：大多数 adapter 一次请求把上游给的全拿回来，没有内部取舍可交代。
// 而**逐条取的源**（HN 一条评论一次请求）不一样 —— 它会跳过取失败的、跳过被删的、
// 撞到条数上限就停，而这三件事在 `[]FetchedJob` 里长得一模一样：条数变少而已。
// 真环境里因此出现过「262 条评论进来 1 条，没有任何一处说得出为什么」（F-E-19）。
//
// 实现它的 adapter 由 Registry 优先走这条路；没实现的照旧走 Fetch。
type Accountant interface {
	FetchAccounted(ctx context.Context, cfgRaw []byte) (Accounted, error)
}

// Accounted —— 一趟取数的账：拿到了什么 + 上游一共有多少 + 我们看了多少 + 按原因跳过多少。
//
// `Available` 是**上游自己说的**总量（不知道就是 0）；`Read` 是我们真的过了一遍的条数；
// `Skipped` 按原因分开计数 —— 「取失败」和「这条被删了」必须分得开，
// 混成一个数字就等于没数（那正是 F-E-19 的成因）。
type Accounted struct {
	Skipped   map[string]int
	Jobs      []jobsmodel.FetchedJob
	Available int
	Read      int
	Truncated bool
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
	Jobicy          string
	Remotive        string
	Himalayas       string
	WorkingNomads   string
	Recruitee       string
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
			KindGreenhouse:       newGreenhouseFetcher(client, b.Greenhouse),
			KindLever:            newLeverFetcher(client, b.Lever),
			KindAshby:            newAshbyFetcher(client, b.Ashby),
			KindRemoteOK:         newRemoteOKFetcher(client, b.RemoteOK),
			KindWWR:              newWWRFetcher(client, b.WWR),
			KindHNHiring:         newHNHiringFetcher(client, b.HN),
			KindSmartRecruiters:  newSmartRecruitersFetcher(client, b.SmartRecruiters),
			KindWorkable:         newWorkableFetcher(client, b.Workable),
			KindJBA:              newJBAFetcher(client, b.JBA),
			KindWorkday:          newWorkdayFetcher(client, b.Workday),
			KindBambooHR:         newBambooHRFetcher(client, b.BambooHR),
			KindJobicy:           newJobicyFetcher(client, b.Jobicy),
			KindRemotive:         newRemotiveFetcher(client, b.Remotive),
			KindHimalayas:        newHimalayasFetcher(client, b.Himalayas),
			KindWorkingNomads:    newWorkingNomadsFetcher(client, b.WorkingNomads),
			KindRecruitee:        newRecruiteeFetcher(client, b.Recruitee),
			KindJobPostingJSONLD: newJSONLDFetcher(client, ""),
		},
	}
}

// Fetch 按 kind 路由到对应 adapter。返 jobsmodel.ErrJobSourceKindInvalid 如果
// kind 不认识。
func (r *Registry) Fetch(
	ctx context.Context, kind string, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	acc, err := r.FetchAccounted(ctx, kind, cfgRaw)
	if err != nil {
		return nil, err
	}
	return acc.Jobs, nil
}

// FetchAccounted —— 跟 Fetch 同一条路，但**把账也带回来**。实现了 Accountant 的 adapter
// 走它自己的那条；没实现的，账就是「拿到几条、看了几条，没有跳过」。
func (r *Registry) FetchAccounted(
	ctx context.Context, kind string, cfgRaw []byte,
) (Accounted, error) {
	f, ok := r.fetchers[kind]
	if !ok {
		return Accounted{}, fmt.Errorf("fetch kind %q: %w",
			kind, jobsmodel.ErrJobSourceKindInvalid)
	}
	if a, isAcc := f.(Accountant); isAcc {
		acc, aerr := a.FetchAccounted(ctx, cfgRaw)
		if aerr != nil {
			return Accounted{}, fmt.Errorf("fetch %s: %w", kind, aerr)
		}
		acc.Jobs = readableJobs(acc.Jobs)
		return acc, nil
	}
	jobs, ferr := f.Fetch(ctx, cfgRaw)
	if ferr != nil {
		return Accounted{}, fmt.Errorf("fetch %s: %w", kind, ferr)
	}
	out := readableJobs(jobs)
	return Accounted{Jobs: out, Read: len(out)}, nil
}

// readableJobs —— 每个源交回来的字都要变成**文字**再进池子（F-E-7）。
//
// 为什么在这里而不是十个适配器里各补一刀：这是它们唯一的汇合点。板子给的是 HTML
// （greenhouse 还是双重转义的），而 title 会直接印在 `/admin/listings` 上、body_text 会直接
// 喂给 owner 的模型 —— 两处都是给人/给模型读的位置，标记在那儿不是内容。适配器仍然
// **不解析结构**（Company | Title | … 那种切分照旧留给 Claude），这一步只解开传输层的编码。
func readableJobs(jobs []jobsmodel.FetchedJob) []jobsmodel.FetchedJob {
	for i := range jobs {
		jobs[i].Title = strings.TrimSpace(plaintext.FromHTML(jobs[i].Title))
		jobs[i].BodyText = plaintext.FromHTML(jobs[i].BodyText)
		// company 也走同一刀（F-E-30）。这一行以前只 TrimSpace —— 而 title 和 body_text
		// 就在它上下两行解着 HTML。代价现形在最要命的地方：一份寄给招聘方的简历 PDF，
		// 页眉上印着 `STORE MANAGER · FOR JACK &AMP; JONES`（prod 上真渲出来的）。
		// 真 RemoteOK 发的就是 `"company":"JACK &amp; JONES"`。
		jobs[i].Company = strings.TrimSpace(plaintext.FromHTML(jobs[i].Company))
		jobs[i].Location = normalizeLocation(jobs[i].Location)
	}
	return jobs
}

// normalizeLocation —— 逗号分段的地点串，规范化一次（UX-88）。
//
// RemoteOK **自己**发的就是 `"San Francisco, "`：城市有、地区空，分隔符照留。忠实映射把它原样
// 带进池子，于是 `/admin/listings` 上读作 `remoteok · Karratha,` —— owner 会以为后面还有字被截了。
// 修在这里而不是在那一列的渲染处：location 有好几个消费者（列表、`jobs.show`、简历草稿里的
// JD 摘要），在展示处补丁就是每处各修一遍，而且下一个消费者又会忘（全局规矩第 4 条：
// **外来数据在入口处规范化一次，下游当字段总在**）。
//
// 规则是「按分隔符切开、丢掉空段、再接回去」，不是「把结尾的逗号砍掉」——
// 后者管不了 `", Australia"` 和 `"Berlin, , DE"`，而它们是同一件事的另外两个面。
// 真的两段（`"Sydney, Australia"`）原样穿过。
func normalizeLocation(s string) string {
	parts := strings.Split(s, ",")
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			kept = append(kept, trimmed)
		}
	}
	// 末尾还可能挂着别的裸分隔符（`"Remote -"`），那不是逗号切得开的。
	return strings.TrimRight(strings.Join(kept, ", "), " -–—;/|")
}

// ValidateKindConfig —— 在 register_source 路径上校验 (kind, config) 形状：
// kind 是否在 enum + config JSON 解到 per-kind 类型 + 必填字段非空。
func ValidateKindConfig(kind string, cfgRaw []byte) error {
	v, ok := configValidators[kind]
	if !ok {
		return fmt.Errorf("kind %q: %w", kind, jobsmodel.ErrJobSourceKindInvalid)
	}
	if err := v(cfgRaw); err != nil {
		return fmt.Errorf("%s config: %w", kind, err)
	}
	return nil
}

// configValidators 是 kind → cfg-shape-check 的 dispatch 表。每个 entry
// 复用 adapter 自己的 typed config struct，保持唯一真理源。
var configValidators = map[string]func([]byte) error{
	KindGreenhouse:       validateGreenhouseCfg,
	KindLever:            validateLeverCfg,
	KindAshby:            validateAshbyCfg,
	KindSmartRecruiters:  validateSmartRecruitersCfg,
	KindWorkable:         validateWorkableCfg,
	KindWWR:              validateWWRCfg,
	KindRemoteOK:         validateEmptyCfg,
	KindHNHiring:         validateEmptyCfg,
	KindJBA:              validateJBACfg,
	KindWorkday:          validateWorkdayCfg,
	KindBambooHR:         validateBambooHRCfg,
	KindJobicy:           validateEmptyCfg,
	KindRemotive:         validateEmptyCfg,
	KindHimalayas:        validateEmptyCfg,
	KindWorkingNomads:    validateEmptyCfg,
	KindRecruitee:        validateRecruiteeCfg,
	KindJobPostingJSONLD: validateJSONLDCfg,
}

// validateEmptyCfg —— remoteok / hn_hiring 不需要任何 config，传啥都接受。
func validateEmptyCfg(_ []byte) error { return nil }

// ErrUpstream —— adapter 收到非 2xx HTTP（含 5xx）。caller 可 errors.Is
// 区分"源死了"vs"配置错"。
var ErrUpstream = errors.New("upstream job board error")

// 下面三条**包着** ErrUpstream（`%w`），所以既有的 `errors.Is(err, ErrUpstream)` 照旧成立，
// 而想分得更细的地方可以往下问一层。
//
// **为什么要分**：owner 那一行只写「下一步做什么」，而这三种处境的下一步互不相同 ——
// 搬家了要去找新地址；没有这块板子要去改拼错的 slug；被限流则什么都不用做。
// 以前它们挤在同一个类里，于是同一句 "it may have moved" 对 404 说了假话，
// 把 owner 支去找一个不存在的新地址（F-E-28，prod 上真撞到过）。
// 一个错误类塌掉，为它写的那句话就永远出不来（[[collapsed-error-class-kills-its-own-branch]]）。
var (
	// ErrUpstreamMoved —— 3xx。板子换地址了，而这个 client 故意不跟随重定向（SSRF 硬化）。
	ErrUpstreamMoved = fmt.Errorf("%w: the board redirected us", ErrUpstream)
	// ErrUpstreamNoBoard —— 404 / 410。这个地址上没有板子：多半是 company slug 拼错，
	// 或这家公司不再用这个 ATS 了。
	ErrUpstreamNoBoard = fmt.Errorf("%w: no board at that address", ErrUpstream)
	// ErrUpstreamBusy —— 429 / 503。板子让我们慢一点。owner 无事可做，下一轮会再试。
	ErrUpstreamBusy = fmt.Errorf("%w: the board asked us to slow down", ErrUpstream)
)

// ErrUpstreamSchema —— 源回了 2xx 但 payload shape 不符（字段缺、JSON 解不开）。
// 通常是 fixture 漂移或源改 API 字段。
var ErrUpstreamSchema = errors.New("upstream schema mismatch")

// ErrUpstreamAuth —— 上游拒了这把凭据。**必须跟 ErrUpstreamSchema 分开**：owner 要采取的
// 下一步完全不同（换 token vs. 修适配器），而真 Workable 把认证失败伪装成后者 ——
// 坏 token 它回 `302 → /oops`（HTML），跟着跳就变成「2xx 但解不开」（F-E-17）。
var ErrUpstreamAuth = errors.New("upstream rejected the credential")
