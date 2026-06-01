// jobs_views.go —— jobs.* tool 响应的 JSON 形状。

package mcp

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
)

type jobSourceViewT struct {
	LastFetchedAt *string         `json:"last_fetched_at,omitempty"`
	ID            string          `json:"id"`
	Kind          string          `json:"kind"`
	Label         string          `json:"label"`
	CreatedAt     string          `json:"created_at"`
	Config        json.RawMessage `json:"config"`
}

type fetchedJobView struct {
	PublishedAt string   `json:"published_at,omitempty"`
	CacheID     string   `json:"cache_id"`
	SourceID    string   `json:"source_id"`
	SourceKind  string   `json:"source_kind"`
	ExternalID  string   `json:"external_id"`
	Title       string   `json:"title"`
	Company     string   `json:"company"`
	Location    string   `json:"location"`
	URL         string   `json:"url"`
	BodyText    string   `json:"body_text,omitempty"`
	Tags        []string `json:"tags"`
}

func jobSourceView(s *domain.JobSource) jobSourceViewT {
	cfg := json.RawMessage(s.Config)
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	v := jobSourceViewT{
		ID:        s.ID,
		Kind:      s.Kind,
		Label:     s.Label,
		Config:    cfg,
		CreatedAt: s.CreatedAt.Format(mcpTimeFmt),
	}
	if s.LastFetchedAt != nil {
		t := s.LastFetchedAt.Format(mcpTimeFmt)
		v.LastFetchedAt = &t
	}
	return v
}

func (p *jobSourceViewT) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal job source view: %w", err)
	}
	return b, nil
}

func (p *fetchedJobView) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal fetched job view: %w", err)
	}
	return b, nil
}

func fetchedJobViews(jobs []domain.FetchedJob) []fetchedJobView {
	out := make([]fetchedJobView, 0, len(jobs))
	for i := range jobs {
		out = append(out, fetchedJobToView(&jobs[i]))
	}
	return out
}

func fetchedJobToView(j *domain.FetchedJob) fetchedJobView {
	v := fetchedJobView{
		CacheID:    j.CacheID,
		SourceID:   j.SourceID,
		SourceKind: j.SourceKind,
		ExternalID: j.ExternalID,
		Title:      j.Title,
		Company:    j.Company,
		Location:   j.Location,
		URL:        j.URL,
		BodyText:   j.BodyText,
		Tags:       j.Tags,
	}
	if !j.PublishedAt.IsZero() {
		v.PublishedAt = j.PublishedAt.Format(time.RFC3339)
	}
	return v
}
