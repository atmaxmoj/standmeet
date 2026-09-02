// recruitee.go — Recruitee Careers Site public API (per-company, no auth).
//
//	GET https://{company}.recruitee.com/api/offers/
//
// Returns {"offers": [...]}. Each offer: id (int), title, description (HTML),
// requirements (HTML, separate field), company_name, careers_url,
// published_at (RFC3339), department, employment_type_code, tags[],
// locations[] ({city, country, country_code, ...}).
//
// Company lives in the HOST (subdomain), not the path — unlike Greenhouse. In
// production the base is built from the config's company; an env override
// (e2e/dev mock) replaces the whole base and the company is only used for the
// path-less mock. Config: {"company": "..."}.

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

type recruiteeConfig struct {
	Company string `json:"company"`
}

type recruiteeFetcher struct {
	client  *http.Client
	envBase string // when set (e2e/dev), replaces the {company}.recruitee.com host
}

func newRecruiteeFetcher(client *http.Client, envBase string) *recruiteeFetcher {
	return &recruiteeFetcher{client: client, envBase: envBase}
}

func (f *recruiteeFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseRecruiteeConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	base := firstOrDefault(f.envBase, "https://"+cfg.Company+".recruitee.com")
	url := base + "/api/offers/"
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload recruiteeResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.Offers))
	for i := range payload.Offers {
		out = append(out, recruiteeToDomain(&payload.Offers[i]))
	}
	return out, nil
}

func parseRecruiteeConfig(raw []byte) (recruiteeConfig, error) {
	var cfg recruiteeConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("recruitee config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("recruitee missing company: %w",
			jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

// validateRecruiteeCfg — used by configValidators dispatch in jobfetch.go.
func validateRecruiteeCfg(raw []byte) error {
	_, err := parseRecruiteeConfig(raw)
	return err
}

type recruiteeResp struct {
	Offers []recruiteeOffer `json:"offers"`
}

type recruiteeOffer struct {
	Title          string              `json:"title"`
	Description    string              `json:"description"`
	Requirements   string              `json:"requirements"`
	CompanyName    string              `json:"company_name"`
	CareersURL     string              `json:"careers_url"`
	PublishedAt    string              `json:"published_at"`
	Department     string              `json:"department"`
	EmploymentType string              `json:"employment_type_code"`
	Tags           []string            `json:"tags"`
	Locations      []recruiteeLocation `json:"locations"`
	ID             int64               `json:"id"`
}

type recruiteeLocation struct {
	City    string `json:"city"`
	Country string `json:"country"`
}

func recruiteeToDomain(o *recruiteeOffer) jobsmodel.FetchedJob {
	return jobsmodel.FetchedJob{
		ExternalID:  strconv.FormatInt(o.ID, decimalRadix),
		Title:       o.Title,
		Company:     o.CompanyName,
		Location:    recruiteeLocationLine(o.Locations),
		URL:         o.CareersURL,
		BodyText:    recruiteeBody(o),
		Tags:        recruiteeTags(o),
		PublishedAt: parseISOTime(o.PublishedAt),
		SourceKind:  KindRecruitee,
	}
}

// recruiteeBody joins the two HTML fields the feed splits a posting across.
func recruiteeBody(o *recruiteeOffer) string {
	parts := make([]string, 0, 2)
	parts = appendIfNonEmpty(parts, o.Description)
	parts = appendIfNonEmpty(parts, o.Requirements)
	return strings.Join(parts, "\n\n")
}

func recruiteeLocationLine(locs []recruiteeLocation) string {
	if len(locs) == 0 {
		return ""
	}
	parts := make([]string, 0, 2)
	parts = appendIfNonEmpty(parts, locs[0].City)
	parts = appendIfNonEmpty(parts, locs[0].Country)
	return strings.Join(parts, ", ")
}

func recruiteeTags(o *recruiteeOffer) []string {
	tags := make([]string, 0, len(o.Tags)+2)
	tags = appendIfNonEmpty(tags, o.Department)
	tags = appendIfNonEmpty(tags, o.EmploymentType)
	for _, t := range o.Tags {
		tags = appendIfNonEmpty(tags, t)
	}
	return tags
}
