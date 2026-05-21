// greenhouse.go —— Greenhouse Job Board public API。
//
//	GET {base}/v1/boards/{company}/jobs?content=true
//
// 返回 {"jobs": [...]}。每条 job 有 id (int) / title / company_name /
// location.name / departments[] / offices[] / first_published (ISO) /
// updated_at (ISO) / absolute_url / content (HTML 转义后的 string)。
//
// fetcher 不解 content HTML —— 当 raw text 传给 agent 让 Claude 自己读。

package jobfetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

const greenhouseDefaultBase = "https://boards-api.greenhouse.io"

type greenhouseConfig struct {
	Company string `json:"company"`
}

type greenhouseFetcher struct {
	client *http.Client
	base   string
}

func newGreenhouseFetcher(client *http.Client, envBase string) *greenhouseFetcher {
	return &greenhouseFetcher{
		client: client,
		base:   firstOrDefault(envBase, greenhouseDefaultBase),
	}
}

// Fetch reads {base}/v1/boards/{company}/jobs?content=true.
func (f *greenhouseFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]domain.FetchedJob, error) {
	cfg, err := parseGreenhouseConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/v1/boards/%s/jobs?content=true", f.base, cfg.Company)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload greenhouseResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]domain.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, greenhouseToDomain(&payload.Jobs[i]))
	}
	return out, nil
}

// parseGreenhouseConfig unmarshals + validates the per-source config.
func parseGreenhouseConfig(raw []byte) (greenhouseConfig, error) {
	var cfg greenhouseConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("greenhouse config decode: %w: %w",
				domain.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("greenhouse missing company: %w", domain.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

// validateGreenhouseCfg —— used by configValidators dispatch in jobfetch.go.
func validateGreenhouseCfg(raw []byte) error {
	_, err := parseGreenhouseConfig(raw)
	return err
}

type greenhouseResp struct {
	Jobs []greenhouseJob `json:"jobs"`
}

type greenhouseJob struct {
	Title          string             `json:"title"`
	CompanyName    string             `json:"company_name"`
	FirstPublished string             `json:"first_published"`
	UpdatedAt      string             `json:"updated_at"`
	AbsoluteURL    string             `json:"absolute_url"`
	Content        string             `json:"content"`
	Location       greenhouseLocation `json:"location"`
	Departments    []greenhouseTagged `json:"departments"`
	Offices        []greenhouseTagged `json:"offices"`
	ID             int64              `json:"id"`
}

type greenhouseLocation struct {
	Name string `json:"name"`
}

type greenhouseTagged struct {
	Name string `json:"name"`
}

func greenhouseToDomain(j *greenhouseJob) domain.FetchedJob {
	return domain.FetchedJob{
		ExternalID:  strconv.FormatInt(j.ID, decimalRadix),
		Title:       j.Title,
		Company:     j.CompanyName,
		Location:    j.Location.Name,
		URL:         j.AbsoluteURL,
		BodyText:    j.Content,
		Tags:        greenhouseTags(j),
		PublishedAt: parseISOTime(j.FirstPublished),
		SourceKind:  KindGreenhouse,
	}
}

func greenhouseTags(j *greenhouseJob) []string {
	tags := make([]string, 0, len(j.Departments)+len(j.Offices))
	for _, d := range j.Departments {
		tags = appendIfNonEmpty(tags, d.Name)
	}
	for _, o := range j.Offices {
		tags = appendIfNonEmpty(tags, o.Name)
	}
	return tags
}

// parseISOTime —— Greenhouse / Ashby 返 RFC3339；Lever 用 epoch 毫秒。
// 解不开返 zero time，调用方 sort 时容忍 zero 排最后。
func parseISOTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
