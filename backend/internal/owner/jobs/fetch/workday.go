// workday.go —— Workday CXS (Candidate eXperience Service) public jobs
// endpoint。每个 tenant 自己 host 在 wd{N}.myworkdayjobs.com，N 是数据
// 中心 (wd1/wd3/wd5/...)；不能假定固定。
//
//	POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
//	Content-Type: application/json
//	body: {"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
//
// 返回 {"total": N, "jobPostings": [{title, locationsText, externalPath,
// postedOn, ...}]}。limit 20 是 endpoint 默认；想多翻页 cfg 设 max_jobs。
//
// adapter 在第一页就停 (limit=100 单页够多数小公司)；分页留 J 期后续优化。
// JBA scraper 走多页 + retry 是因为它扒全集；owner 个人源单页足矣。

package fetch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	workdayDefaultHostPattern = "https://%s.wd%s.myworkdayjobs.com"
	// workdayPageLimit —— **厂商的每页上限，不是我们的偏好**。2026-08-16 在两个真租户上
	// 各量过一次：`redhat` / `nvidia`，`limit:20` → 200，**`limit:21` → 400**。
	// 这里原来写的是 100，于是**每一次真 Workday 取数都是 400**，而 mock 对 limit
	// 来者不拒，CI 一路绿（F-E-15）。
	workdayPageLimit = 20
	// workdayMaxPages —— 翻页的硬上限。真 Workday 上 total 可以到几千（nvidia 2000），
	// 一个 owner 的源不该把整间公司的岗位都拖回来；到顶就停，并且**说出来**（下面那行日志）。
	workdayMaxPages = 25
)

type workdayConfig struct {
	Tenant string `json:"tenant"`
	WD     string `json:"wd"`
	Site   string `json:"site"`
}

type workdayFetcher struct {
	client  *http.Client
	envBase string
}

func newWorkdayFetcher(client *http.Client, envBase string) *workdayFetcher {
	return &workdayFetcher{client: client, envBase: envBase}
}

// Fetch walks the CXS jobs query to the END of the collection.
//
// 一页最多 20 条（厂商定的），而真租户动辄上百上千（`redhat` 149 / `salesforce` 1514 /
// `nvidia` 2000），所以「取第一页」跟「这家就这么多岗位」在结果上分不出来 —— 那正是
// F-E-16 要防的静默截断。收敛条件有三个，缺一不可：拿满 `total`、某一页回空、或撞到
// `workdayMaxPages`（撞到就记一行日志，不让截断悄悄发生）。
func (f *workdayFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseWorkdayConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	u := f.buildURL(&cfg)
	walk := &workdayWalk{out: make([]jobsmodel.FetchedJob, 0, workdayPageLimit)}
	for page := range workdayMaxPages {
		if perr := f.walkPage(ctx, &u, cfg.Tenant, page, walk); perr != nil {
			return nil, perr
		}
		if walk.done() {
			return walk.out, nil
		}
	}
	// 到这儿说明还没取完就撞了页数上限。返回已取到的部分,但把它记下来 ——
	// 「取到一部分」不许长得跟「全部就这些」一样(no silent caps)。
	slog.WarnContext(ctx, "workday page cap reached; result is partial",
		"url", u.jobsURL, "pages", workdayMaxPages, "fetched", len(walk.out))
	return walk.out, nil
}

// workdayWalk —— 一次翻页遍历的状态：已取到的、最近一页的条数、**第一页**报的 total。
type workdayWalk struct {
	out   []jobsmodel.FetchedJob
	got   int
	total int
}

// done —— 翻到底了吗。**短页才是可靠的终点信号**：一页给不满 limit，说明后面没有了。
//
// `total` 只信**第一页**那一份（见 walkPage）—— 真 Workday 在后续页上把它报成 0
// （nvidia，2026-08-16：`offset=0` → `total:2000`，`offset=20/40/60` → `total:0`，
// 而每页照样给 20 条）。曾经拿每一页自己的 total 判，于是第二页的 0 让
// `len(out) >= 0` 恒真，2000 条只拿回 40 条 —— **比那个 400 更难发现的静默截断**，
// 而且夹具凑巧是 25 条时它还能绿（第二页正好是短页）。夹具改成 45 条就是为了逼出它。
func (w *workdayWalk) done() bool {
	return w.got < workdayPageLimit || (w.total > 0 && len(w.out) >= w.total)
}

// walkPage —— 取第 page 页、映射进 walk.out，并把「这一页几条 / 第一页的 total」记进状态。
func (f *workdayFetcher) walkPage(
	ctx context.Context, u *workdayURL, tenant string, page int, walk *workdayWalk,
) error {
	body, err := f.postQuery(ctx, u.jobsURL, u.host, page*workdayPageLimit)
	if err != nil {
		return err
	}
	var payload workdayResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return fmt.Errorf("decode %s: %w: %w", u.jobsURL, ErrUpstreamSchema, uerr)
	}
	for i := range payload.JobPostings {
		walk.out = append(walk.out, workdayToDomain(&payload.JobPostings[i], u.host, tenant))
	}
	walk.got = len(payload.JobPostings)
	if page == 0 {
		walk.total = payload.Total
	}
	return nil
}

// workdayURL pairs the (host, jobs URL) Workday's CXS endpoint needs:
// host goes into the Origin request header and prefixes the per-job URL;
// jobsURL is what we POST to.
type workdayURL struct {
	host    string
	jobsURL string
}

func (f *workdayFetcher) buildURL(cfg *workdayConfig) workdayURL {
	host := f.envBase
	if host == "" {
		host = fmt.Sprintf(workdayDefaultHostPattern, cfg.Tenant, cfg.WD)
	}
	jobsURL := fmt.Sprintf("%s/wday/cxs/%s/%s/jobs", host, cfg.Tenant, cfg.Site)
	return workdayURL{host: host, jobsURL: jobsURL}
}

// postQuery —— Workday CXS 要 POST JSON body。共享 getBody 是 GET-only;
// 单独把请求构造跟 status check 内联，handler 自己 close response body。
func (f *workdayFetcher) postQuery(
	ctx context.Context, url, host string, offset int,
) ([]byte, error) {
	payload := []byte(
		`{"appliedFacets":{},"limit":` +
			strconv.Itoa(workdayPageLimit) +
			`,"offset":` + strconv.Itoa(offset) +
			`,"searchText":""}`,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Origin", host)
	resp, derr := f.client.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("%s: %w: %w", url, ErrUpstream, derr)
	}
	defer closeQuiet(resp.Body)
	return readOK(resp, url)
}

func parseWorkdayConfig(raw []byte) (workdayConfig, error) {
	var cfg workdayConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("workday config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if missing := firstMissingWorkdayField(&cfg); missing != "" {
		return cfg, fmt.Errorf("workday missing %s: %w",
			missing, jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func firstMissingWorkdayField(cfg *workdayConfig) string {
	for _, f := range []struct {
		name, value string
	}{
		{"tenant", cfg.Tenant},
		{"wd", cfg.WD},
		{"site", cfg.Site},
	} {
		if f.value == "" {
			return f.name
		}
	}
	return ""
}

func validateWorkdayCfg(raw []byte) error {
	_, err := parseWorkdayConfig(raw)
	return err
}

type workdayResp struct {
	JobPostings []workdayJob `json:"jobPostings"`
	Total       int          `json:"total"`
}

// workdayJob —— 只声明**我们真的用**的字段。
//
// 这里曾经还有一个 `BulletFields string`，谁都没读它，而真 Workday 发的是
// **数组**（`"bulletFields":["R-12345"]`，2026-08-16 在 nvidia 上撞到）——
// 于是一个没人用的字段把整份响应的解码搞崩：
// *"cannot unmarshal array into Go struct field workdayJob.jobPostings.bulletFields"*。
// 声明一个字段就是签一份契约；不用的字段不要签（`encoding/json` 会安静地跳过未声明的键）。
type workdayJob struct {
	Title         string `json:"title"`
	LocationsText string `json:"locationsText"`
	ExternalPath  string `json:"externalPath"`
	PostedOn      string `json:"postedOn"`
}

func workdayToDomain(j *workdayJob, host, tenant string) jobsmodel.FetchedJob {
	url := host + j.ExternalPath
	// externalPath 形如 /en-US/{site}/job/.../R-12345；ExternalID = path 末
	// 段，稳定且全 tenant 唯一。fallback 全 path。
	externalID := j.ExternalPath
	if idx := strings.LastIndex(j.ExternalPath, "/"); idx >= 0 && idx < len(j.ExternalPath)-1 {
		externalID = j.ExternalPath[idx+1:]
	}
	// Workday 用 "Posted N Days Ago" 自然语言串而非 ISO；当前 PublishedAt
	// 留 zero (caller 排序兼容 zero time)。J 期后续真要 sort by date 再加
	// relative-time parser。
	return jobsmodel.FetchedJob{
		ExternalID:  externalID,
		Title:       j.Title,
		Company:     tenant,
		Location:    j.LocationsText,
		URL:         url,
		PublishedAt: time.Time{},
		SourceKind:  KindWorkday,
	}
}
