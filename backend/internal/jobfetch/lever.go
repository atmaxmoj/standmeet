// lever.go —— Lever public postings API。
//
//	GET {base}/v0/postings/{company}?mode=json
//
// 返回数组（不是 envelope）。每条 { id (uuid), text (title), categories
// { commitment, department, location, team }, createdAt (epoch ms),
// hostedUrl, applyUrl, description (HTML), tags? }。

package jobfetch

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

const leverDefaultBase = "https://api.lever.co"

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
	ctx context.Context, cfg map[string]any,
) ([]domain.FetchedJob, error) {
	company := companyField(cfg)
	if company == "" {
		return nil, fmt.Errorf("lever missing company: %w", domain.ErrJobSourceConfigInvalid)
	}
	url := fmt.Sprintf("%s/v0/postings/%s?mode=json", f.base, company)
	var arr []leverPosting
	if err := getJSON(ctx, f.client, url, &arr); err != nil {
		return nil, err
	}
	out := make([]domain.FetchedJob, 0, len(arr))
	for i := range arr {
		out = append(out, leverToDomain(&arr[i], company))
	}
	return out, nil
}

type leverPosting struct {
	ID          string        `json:"id"`
	Text        string        `json:"text"`
	HostedURL   string        `json:"hostedUrl"`
	ApplyURL    string        `json:"applyUrl"`
	Description string        `json:"description"`
	Categories  leverCategory `json:"categories"`
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

func leverToDomain(p *leverPosting, company string) domain.FetchedJob {
	tags := make([]string, 0, 3+len(p.Tags))
	if p.Categories.Department != "" {
		tags = append(tags, p.Categories.Department)
	}
	if p.Categories.Team != "" {
		tags = append(tags, p.Categories.Team)
	}
	if p.Categories.Commitment != "" {
		tags = append(tags, p.Categories.Commitment)
	}
	tags = append(tags, p.Tags...)

	url := p.ApplyURL
	if url == "" {
		url = p.HostedURL
	}
	return domain.FetchedJob{
		ExternalID:  p.ID,
		Title:       p.Text,
		Company:     company,
		Location:    p.Categories.Location,
		URL:         url,
		BodyText:    p.Description,
		Tags:        tags,
		PublishedAt: epochMillisToTime(p.CreatedAt),
		SourceKind:  KindLever,
	}
}

func epochMillisToTime(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}
