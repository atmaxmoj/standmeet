// smartrecruiters.go —— SmartRecruiters posting API (v1.1，先实现 GET shape，
// 真测覆盖等 v1.1 PR)。
//
//	GET {base}/v1/companies/{company}/postings?limit=200
//
// 响应 {offset, limit, totalFound, content: [...]}。每条 posting 有
// id / name / refNumber / company.name / location.{country,region,city,remote}
// / department.label / releasedDate / industry.label / typeOfEmployment.label
// / experienceLevel.label。
//
// 这里实现 adapter 但 v1 不进 registry 默认列；待 v1.1 真要用时再 wire。

package jobfetch

import (
	"context"
	"fmt"
	"net/http"

	"github.com/wangsijie/standmeet/internal/domain"
)

const smartRecruitersDefaultBase = "https://api.smartrecruiters.com"

type smartRecruitersFetcher struct {
	client *http.Client
	base   string
}

func newSmartRecruitersFetcher(client *http.Client, envBase string) *smartRecruitersFetcher {
	return &smartRecruitersFetcher{
		client: client,
		base:   firstOrDefault(envBase, smartRecruitersDefaultBase),
	}
}

func (f *smartRecruitersFetcher) Fetch(
	ctx context.Context, cfg map[string]any,
) ([]domain.FetchedJob, error) {
	company := companyField(cfg)
	if company == "" {
		return nil, fmt.Errorf("smartrecruiters missing company: %w", domain.ErrJobSourceConfigInvalid)
	}
	url := fmt.Sprintf("%s/v1/companies/%s/postings?limit=200", f.base, company)
	var payload srResp
	if err := getJSON(ctx, f.client, url, &payload); err != nil {
		return nil, err
	}
	out := make([]domain.FetchedJob, 0, len(payload.Content))
	for i := range payload.Content {
		out = append(out, srToDomain(&payload.Content[i], company))
	}
	return out, nil
}

type srResp struct {
	Content []srPosting `json:"content"`
}

type srPosting struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	Department       srLabel    `json:"department"`
	ReleasedDate     string     `json:"releasedDate"`
	Industry         srLabel    `json:"industry"`
	TypeOfEmployment srLabel    `json:"typeOfEmployment"`
	ExperienceLevel  srLabel    `json:"experienceLevel"`
	RefNumber        string     `json:"refNumber"`
	Location         srLocation `json:"location"`
}

type srLocation struct {
	Country string `json:"country"`
	Region  string `json:"region"`
	City    string `json:"city"`
	Remote  bool   `json:"remote"`
}

type srLabel struct {
	Label string `json:"label"`
}

func srToDomain(p *srPosting, company string) domain.FetchedJob {
	loc := firstNonEmpty(p.Location.City, p.Location.Region, p.Location.Country)
	if p.Location.Remote {
		loc = firstNonEmpty(loc, "Remote")
	}
	tags := make([]string, 0, 4)
	if p.Department.Label != "" {
		tags = append(tags, p.Department.Label)
	}
	if p.Industry.Label != "" {
		tags = append(tags, p.Industry.Label)
	}
	if p.TypeOfEmployment.Label != "" {
		tags = append(tags, p.TypeOfEmployment.Label)
	}
	if p.ExperienceLevel.Label != "" {
		tags = append(tags, p.ExperienceLevel.Label)
	}
	return domain.FetchedJob{
		ExternalID:  p.ID,
		Title:       p.Name,
		Company:     company,
		Location:    loc,
		URL:         fmt.Sprintf("https://jobs.smartrecruiters.com/%s/%s", company, p.ID),
		BodyText:    "", // SR posting list 不带 body；详情得另调 /v1/postings/{id}/details
		Tags:        tags,
		PublishedAt: parseISOTime(p.ReleasedDate),
		SourceKind:  KindSmartRecruiters,
	}
}
