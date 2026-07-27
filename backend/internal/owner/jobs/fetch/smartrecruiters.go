// smartrecruiters.go —— SmartRecruiters posting API (v1.1 source).
//
//	GET {base}/v1/companies/{company}/postings?limit=200
//
// 响应 {offset, limit, totalFound, content: [...]}。每条 posting 有
// id / name / refNumber / location.{country,region,city,remote}
// / department.label / releasedDate / industry.label / typeOfEmployment.label
// / experienceLevel.label。

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const smartRecruitersDefaultBase = "https://api.smartrecruiters.com"

type smartRecruitersConfig struct {
	Company string `json:"company"`
}

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
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseSmartRecruitersConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/v1/companies/%s/postings?limit=200", f.base, cfg.Company)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload srResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.Content))
	for i := range payload.Content {
		out = append(out, srToDomain(&payload.Content[i], cfg.Company))
	}
	return out, nil
}

func parseSmartRecruitersConfig(raw []byte) (smartRecruitersConfig, error) {
	var cfg smartRecruitersConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("smartrecruiters config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("smartrecruiters missing company: %w",
			jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func validateSmartRecruitersCfg(raw []byte) error {
	_, err := parseSmartRecruitersConfig(raw)
	return err
}

type srResp struct {
	Content []srPosting `json:"content"`
}

type srPosting struct {
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	ReleasedDate     string     `json:"releasedDate"`
	RefNumber        string     `json:"refNumber"`
	Department       srLabel    `json:"department"`
	Industry         srLabel    `json:"industry"`
	TypeOfEmployment srLabel    `json:"typeOfEmployment"`
	ExperienceLevel  srLabel    `json:"experienceLevel"`
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

func srToDomain(p *srPosting, company string) jobsmodel.FetchedJob {
	loc := firstNonEmpty(p.Location.City, p.Location.Region, p.Location.Country)
	if p.Location.Remote {
		loc = firstNonEmpty(loc, "Remote")
	}
	return jobsmodel.FetchedJob{
		ExternalID:  p.ID,
		Title:       p.Name,
		Company:     company,
		Location:    loc,
		URL:         fmt.Sprintf("https://jobs.smartrecruiters.com/%s/%s", company, p.ID),
		BodyText:    "", // SR posting list 不带 body；详情得另调 /v1/postings/{id}/details
		Tags:        srTags(p),
		PublishedAt: parseISOTime(p.ReleasedDate),
		SourceKind:  KindSmartRecruiters,
	}
}

func srTags(p *srPosting) []string {
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, p.Department.Label)
	tags = appendIfNonEmpty(tags, p.Industry.Label)
	tags = appendIfNonEmpty(tags, p.TypeOfEmployment.Label)
	tags = appendIfNonEmpty(tags, p.ExperienceLevel.Label)
	return tags
}
