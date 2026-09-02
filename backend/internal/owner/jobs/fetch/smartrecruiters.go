// smartrecruiters.go —— SmartRecruiters posting API (v1.1 source).
//
//	GET {base}/v1/companies/{company}/postings?limit=200
//
// The response is {offset, limit, totalFound, content: [...]}. Each posting has
// id / name / refNumber / location.{country,region,city,remote}
// / department.label / releasedDate / industry.label / typeOfEmployment.label
// / experienceLevel.label.

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	smartRecruitersDefaultBase = "https://api.smartrecruiters.com"
	// smartRecruitersPageLimit —— **the vendor's own per-page ceiling**. Measured: on
	// 2026-08-16 a request for `?limit=200` came back with `"limit":100` in the
	// response body — it silently clamps to 100, neither erroring nor saying it
	// clamped. This used to just request 200 once and call it done, so a company with
	// more than 100 openings got **silently truncated to the first 100** (F-E-16).
	smartRecruitersPageLimit = 100
	// smartRecruitersMaxPages —— hard cap on pagination; hitting it records that the
	// result is partial, instead of letting truncation happen silently.
	smartRecruitersMaxPages = 20
)

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
	walk := &srWalk{out: make([]jobsmodel.FetchedJob, 0, smartRecruitersPageLimit)}
	for page := range smartRecruitersMaxPages {
		if perr := f.walkPage(ctx, cfg.Company, page, walk); perr != nil {
			return nil, perr
		}
		if walk.done() {
			return walk.out, nil
		}
	}
	slog.WarnContext(ctx, "smartrecruiters page cap reached; result is partial",
		"company", cfg.Company, "pages", smartRecruitersMaxPages, "fetched", len(walk.out))
	return walk.out, nil
}

// srWalk —— state of a single pagination walk: what's fetched so far, the count on
// the most recent page, and the totalFound reported by the **first page**.
type srWalk struct {
	out   []jobsmodel.FetchedJob
	got   int
	total int
}

// done —— a short page means the last page; or we've already gotten as many as the
// total size the first page reported.
func (w *srWalk) done() bool {
	return w.got < smartRecruitersPageLimit || (w.total > 0 && len(w.out) >= w.total)
}

// walkPage —— fetches page `page` and maps it into walk.out.
//
// `totalFound` used to **not even get decoded**: the one-request-and-done version had
// no use for it, so the upstream's own signal for "how many openings does this
// company have" was thrown away, and silent truncation had no way to be caught.
func (f *smartRecruitersFetcher) walkPage(
	ctx context.Context, company string, page int, walk *srWalk,
) error {
	url := fmt.Sprintf("%s/v1/companies/%s/postings?limit=%d&offset=%d",
		f.base, company, smartRecruitersPageLimit, page*smartRecruitersPageLimit)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return err
	}
	var payload srResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	for i := range payload.Content {
		walk.out = append(walk.out, srToDomain(&payload.Content[i], company))
	}
	walk.got = len(payload.Content)
	if page == 0 {
		walk.total = payload.TotalFound
	}
	return nil
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
	// TotalFound —— the total size the upstream reports. **Must be decoded**: without
	// it, "we fetched 100" and "this company only has 100 openings" are
	// indistinguishable in the result.
	TotalFound int `json:"totalFound"`
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
		ExternalID: p.ID,
		Title:      p.Name,
		Company:    company,
		Location:   loc,
		URL:        fmt.Sprintf("https://jobs.smartrecruiters.com/%s/%s", company, p.ID),
		BodyText:   "", // the SR posting list carries no body; details need a separate
		// call to /v1/postings/{id}/details
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
