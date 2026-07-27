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
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	workdayDefaultHostPattern = "https://%s.wd%s.myworkdayjobs.com"
	workdayPageLimit          = 100
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

// Fetch POSTs the CXS jobs query and decodes the first page.
func (f *workdayFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseWorkdayConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	u := f.buildURL(&cfg)
	body, err := f.postQuery(ctx, u.jobsURL, u.host)
	if err != nil {
		return nil, err
	}
	var payload workdayResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", u.jobsURL, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.JobPostings))
	for i := range payload.JobPostings {
		out = append(out, workdayToDomain(&payload.JobPostings[i], u.host, cfg.Tenant))
	}
	return out, nil
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
	ctx context.Context, url, host string,
) ([]byte, error) {
	payload := []byte(
		`{"appliedFacets":{},"limit":` +
			strconv.Itoa(workdayPageLimit) +
			`,"offset":0,"searchText":""}`,
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

type workdayJob struct {
	Title         string `json:"title"`
	LocationsText string `json:"locationsText"`
	ExternalPath  string `json:"externalPath"`
	PostedOn      string `json:"postedOn"`
	BulletFields  string `json:"bulletFields"`
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
