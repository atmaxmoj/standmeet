// lever.go —— Lever public postings API。
//
//	GET {base}/v0/postings/{company}?mode=json
//
// 返回数组（不是 envelope）。每条 { id (uuid), text (title), categories
// { commitment, department, location, team }, createdAt (epoch ms),
// hostedUrl, applyUrl, description (HTML), tags? }。

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const leverDefaultBase = "https://api.lever.co"

type leverConfig struct {
	Company string `json:"company"`
}

type leverFetcher struct {
	client *http.Client
	base   string
}

func newLeverFetcher(client *http.Client, envBase string) *leverFetcher {
	return &leverFetcher{
		client: client,
		base:   firstOrDefault(envBase, leverDefaultBase),
	}
}

func (f *leverFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseLeverConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/v0/postings/%s?mode=json", f.base, cfg.Company)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var arr []leverPosting
	if uerr := json.Unmarshal(body, &arr); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(arr))
	for i := range arr {
		out = append(out, leverToDomain(&arr[i], cfg.Company))
	}
	return out, nil
}

func parseLeverConfig(raw []byte) (leverConfig, error) {
	var cfg leverConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("lever config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Company == "" {
		return cfg, fmt.Errorf("lever missing company: %w", jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func validateLeverCfg(raw []byte) error {
	_, err := parseLeverConfig(raw)
	return err
}

type leverPosting struct {
	Categories  leverCategory `json:"categories"`
	ID          string        `json:"id"`
	Text        string        `json:"text"`
	HostedURL   string        `json:"hostedUrl"`
	ApplyURL    string        `json:"applyUrl"`
	Description string        `json:"description"`
	Tags        []string      `json:"tags"`
	CreatedAt   int64         `json:"createdAt"`
}

type leverCategory struct {
	Commitment   string   `json:"commitment"`
	Department   string   `json:"department"`
	Location     string   `json:"location"`
	Team         string   `json:"team"`
	AllLocations []string `json:"allLocations"`
}

func leverToDomain(p *leverPosting, company string) jobsmodel.FetchedJob {
	url := p.ApplyURL
	if url == "" {
		url = p.HostedURL
	}
	return jobsmodel.FetchedJob{
		ExternalID:  p.ID,
		Title:       p.Text,
		Company:     company,
		Location:    p.Categories.Location,
		URL:         url,
		BodyText:    p.Description,
		Tags:        leverTags(p),
		PublishedAt: epochMillisToTime(p.CreatedAt),
		SourceKind:  KindLever,
	}
}

func leverTags(p *leverPosting) []string {
	tags := make([]string, 0, 3+len(p.Tags))
	tags = appendIfNonEmpty(tags, p.Categories.Department)
	tags = appendIfNonEmpty(tags, p.Categories.Team)
	tags = appendIfNonEmpty(tags, p.Categories.Commitment)
	tags = append(tags, p.Tags...)
	return tags
}

func epochMillisToTime(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}
