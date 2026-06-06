// bamboohr.go —— BambooHR 公开 careers 列表 endpoint。
//
//	GET https://{slug}.bamboohr.com/careers/list
//	Accept: application/json
//
// 返回 {"result": [{id, jobOpeningName, location: {city, state, country, ...},
// employmentStatusLabel, departmentLabel, ...}]}。JBA 用这条路径（确认见
// Feashliaa/job-board-aggregator scripts/scraper.py fetch_company_jobs_bamboohr）；
// 真 ATS API (/api/gateway.php) 是 token-gated 的、不通用，careers/list 是 owner-
// facing 公开 UI 后台调的 JSON，每个公司单独 host 在 {slug}.bamboohr.com 子域。

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const bambooHRDefaultBase = "https://%s.bamboohr.com"

type bambooHRConfig struct {
	Company string `json:"company"`
}

type bambooHRFetcher struct {
	client  *http.Client
	envBase string
}

func newBambooHRFetcher(client *http.Client, envBase string) *bambooHRFetcher {
	return &bambooHRFetcher{client: client, envBase: envBase}
}

// Fetch reads {base}/careers/list. base = env override (e2e) 或 hard-coded
// per-company host pattern。
func (f *bambooHRFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]domain.FetchedJob, error) {
	cfg, err := parseBambooHRConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := f.buildURL(cfg.Company)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload bambooHRResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]domain.FetchedJob, 0, len(payload.Result))
	for i := range payload.Result {
		out = append(out, bambooHRToDomain(&payload.Result[i], cfg.Company))
	}
	return out, nil
}

// buildURL —— prod: https://{slug}.bamboohr.com/careers/list; e2e:
// {envBase}/careers/list?company={slug} (mock 单 host 多 slug)。
func (f *bambooHRFetcher) buildURL(slug string) string {
	if f.envBase != "" {
		return fmt.Sprintf("%s/careers/list?company=%s", f.envBase, slug)
	}
	return fmt.Sprintf(bambooHRDefaultBase, slug) + "/careers/list"
}

func parseBambooHRConfig(raw []byte) (bambooHRConfig, error) {
	var cfg bambooHRConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("bamboohr config decode: %w: %w",
				domain.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("bamboohr missing company: %w", domain.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func validateBambooHRCfg(raw []byte) error {
	_, err := parseBambooHRConfig(raw)
	return err
}

type bambooHRResp struct {
	Result []bambooHRJob `json:"result"`
}

// bambooHRJob —— careers/list 单条。location 是 object (city/state/country/
// addressLine1/...) 或 null；employmentStatusLabel / departmentLabel 是 tag。
type bambooHRJob struct {
	Location              *bambooHRLocation `json:"location"`
	JobOpeningName        string            `json:"jobOpeningName"`
	EmploymentStatusLabel string            `json:"employmentStatusLabel"`
	DepartmentLabel       string            `json:"departmentLabel"`
	DatePosted            string            `json:"datePosted"`
	ID                    int64             `json:"id"`
}

type bambooHRLocation struct {
	City    string `json:"city"`
	State   string `json:"state"`
	Country string `json:"country"`
}

func bambooHRToDomain(j *bambooHRJob, slug string) domain.FetchedJob {
	url := fmt.Sprintf("https://"+slug+".bamboohr.com/careers/%d", j.ID)
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, j.DepartmentLabel)
	tags = appendIfNonEmpty(tags, j.EmploymentStatusLabel)
	return domain.FetchedJob{
		ExternalID:  strconv.FormatInt(j.ID, decimalRadix),
		Title:       j.JobOpeningName,
		Company:     slug,
		Location:    bambooHRLocationString(j.Location),
		URL:         url,
		Tags:        tags,
		PublishedAt: parseISOTime(j.DatePosted),
		SourceKind:  KindBambooHR,
	}
}

func bambooHRLocationString(loc *bambooHRLocation) string {
	if loc == nil {
		return ""
	}
	if loc.City != "" && loc.State != "" {
		return loc.City + ", " + loc.State
	}
	return firstNonEmpty(loc.City, loc.State, loc.Country)
}
