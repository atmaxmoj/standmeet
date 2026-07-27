// ashby.go —— Ashby public posting API。
//
//	GET {base}/posting-api/job-board/{slug}
//
// 返回 {"jobs": [...]}。每条 { id, title, department, team, location,
// isRemote, employmentType, publishedAt (ISO), jobUrl, applyUrl,
// descriptionHtml, descriptionPlain }。
//
// 注意：team / department / location 都可能 null（agent 上的真 fixture
// 见到过），解到 *string 兜底 nil。

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const ashbyDefaultBase = "https://api.ashbyhq.com"

type ashbyConfig struct {
	Company string `json:"company"`
}

type ashbyFetcher struct {
	client *http.Client
	base   string
}

func newAshbyFetcher(client *http.Client, envBase string) *ashbyFetcher {
	return &ashbyFetcher{
		client: client,
		base:   firstOrDefault(envBase, ashbyDefaultBase),
	}
}

func (f *ashbyFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseAshbyConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/posting-api/job-board/%s", f.base, cfg.Company)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload ashbyResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, ashbyToDomain(&payload.Jobs[i], cfg.Company))
	}
	return out, nil
}

func parseAshbyConfig(raw []byte) (ashbyConfig, error) {
	var cfg ashbyConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("ashby config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("ashby missing company: %w", jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func validateAshbyCfg(raw []byte) error {
	_, err := parseAshbyConfig(raw)
	return err
}

type ashbyResp struct {
	Jobs []ashbyJob `json:"jobs"`
}

type ashbyJob struct {
	Department       *string `json:"department"`
	Team             *string `json:"team"`
	Location         *string `json:"location"`
	ApplyURL         *string `json:"applyUrl"`
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	EmploymentType   string  `json:"employmentType"`
	PublishedAt      string  `json:"publishedAt"`
	JobURL           string  `json:"jobUrl"`
	DescriptionPlain string  `json:"descriptionPlain"`
	IsRemote         bool    `json:"isRemote"`
}

func ashbyToDomain(j *ashbyJob, company string) jobsmodel.FetchedJob {
	return jobsmodel.FetchedJob{
		ExternalID:  j.ID,
		Title:       j.Title,
		Company:     company,
		Location:    preferNonNil(j.Location, ""),
		URL:         preferNonNil(j.ApplyURL, j.JobURL),
		BodyText:    j.DescriptionPlain,
		Tags:        ashbyTags(j),
		PublishedAt: parseISOTime(j.PublishedAt),
		SourceKind:  KindAshby,
	}
}

func ashbyTags(j *ashbyJob) []string {
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonNil(tags, j.Department)
	tags = appendIfNonNil(tags, j.Team)
	tags = appendIfNonEmpty(tags, j.EmploymentType)
	if j.IsRemote {
		tags = append(tags, "remote")
	}
	return tags
}
