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

package jobfetch

import (
	"context"
	"fmt"
	"net/http"

	"github.com/wangsijie/standmeet/internal/domain"
)

const ashbyDefaultBase = "https://api.ashbyhq.com"

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
	ctx context.Context, cfg map[string]any,
) ([]domain.FetchedJob, error) {
	company := companyField(cfg)
	if company == "" {
		return nil, fmt.Errorf("ashby missing company: %w", domain.ErrJobSourceConfigInvalid)
	}
	url := fmt.Sprintf("%s/posting-api/job-board/%s", f.base, company)
	var payload ashbyResp
	if err := getJSON(ctx, f.client, url, &payload); err != nil {
		return nil, err
	}
	out := make([]domain.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, ashbyToDomain(&payload.Jobs[i], company))
	}
	return out, nil
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

func ashbyToDomain(j *ashbyJob, company string) domain.FetchedJob {
	tags := make([]string, 0, 4)
	if j.Department != nil && *j.Department != "" {
		tags = append(tags, *j.Department)
	}
	if j.Team != nil && *j.Team != "" {
		tags = append(tags, *j.Team)
	}
	if j.EmploymentType != "" {
		tags = append(tags, j.EmploymentType)
	}
	if j.IsRemote {
		tags = append(tags, "remote")
	}
	location := ""
	if j.Location != nil {
		location = *j.Location
	}
	url := j.JobURL
	if j.ApplyURL != nil && *j.ApplyURL != "" {
		url = *j.ApplyURL
	}
	return domain.FetchedJob{
		ExternalID:  j.ID,
		Title:       j.Title,
		Company:     company,
		Location:    location,
		URL:         url,
		BodyText:    j.DescriptionPlain,
		Tags:        tags,
		PublishedAt: parseISOTime(j.PublishedAt),
		SourceKind:  KindAshby,
	}
}
