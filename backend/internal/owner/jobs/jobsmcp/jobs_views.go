// jobs_views.go — JSON shapes for jobs.* tool responses.

package jobsmcp

import (
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

type jobSourceViewT struct {
	LastFetchedAt *string `json:"last_fetched_at,omitempty"`
	// LastAttemptedAt / LastError — when the last ATTEMPT happened and how it went.
	// Reporting only last_fetched_at makes "fails every time" indistinguishable from
	// "never tried" — both show up as the same absence (F-E-18).
	LastAttemptedAt *string         `json:"last_attempted_at,omitempty"`
	LastError       string          `json:"last_error,omitempty"`
	ID              string          `json:"id"`
	Kind            string          `json:"kind"`
	Label           string          `json:"label"`
	CreatedAt       string          `json:"created_at"`
	Config          json.RawMessage `json:"config"`
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

func jobSourceView(s *jobsmodel.JobSource) jobSourceViewT {
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
	if s.LastAttemptedAt != nil {
		t := s.LastAttemptedAt.Format(mcpTimeFmt)
		v.LastAttemptedAt = &t
	}
	v.LastError = s.LastError
	return v
}

// poolRowView — one row in the listing. **No body_text**: that's `jobs.show`'s job.
//
// A single fetch today pulls back two or three hundred real postings, each with a
// one-to-two-thousand-word body. Cramming all of that into the response would burn
// through the owner-side AI's context just receiving this one tool result, and ranking
// only needs title, company, location, tags — the same fields a human scans a job
// board for. The picked ones get their full text via a follow-up `jobs.show`.
type poolRowView struct {
	PublishedAt string   `json:"published_at,omitempty"`
	CacheID     string   `json:"cache_id"`
	SourceID    string   `json:"source_id"`
	SourceKind  string   `json:"source_kind"`
	ExternalID  string   `json:"external_id"`
	Title       string   `json:"title"`
	Company     string   `json:"company"`
	Location    string   `json:"location"`
	URL         string   `json:"url"`
	Tags        []string `json:"tags"`
	// TTLRemainingSeconds — how much longer this row survives in the pool. The design
	// always specified ttl_remaining on fetch_new's response; the implementation missed
	// it. Without it, the owner side has no way to tell "is there still time on this one today?"
	TTLRemainingSeconds int `json:"ttl_remaining_seconds"`
	// New — just landed in the pool this run. Distinguishes "this is today's board" from
	// "here's what's new since you last looked".
	New bool `json:"new"`
}

func poolRowViews(rows []jobsuc.PoolRow) []poolRowView {
	out := make([]poolRowView, 0, len(rows))
	for i := range rows {
		out = append(out, poolRowToView(&rows[i]))
	}
	return out
}

func poolRowToView(r *jobsuc.PoolRow) poolRowView {
	v := poolRowView{
		CacheID:             r.Job.CacheID,
		SourceID:            r.Job.SourceID,
		SourceKind:          r.Job.SourceKind,
		ExternalID:          r.Job.ExternalID,
		Title:               r.Job.Title,
		Company:             r.Job.Company,
		Location:            r.Job.Location,
		URL:                 r.Job.URL,
		Tags:                r.Job.Tags,
		TTLRemainingSeconds: int(r.TTLRemaining / time.Second),
		New:                 r.New,
	}
	if !r.Job.PublishedAt.IsZero() {
		v.PublishedAt = r.Job.PublishedAt.Format(time.RFC3339)
	}
	return v
}

func fetchedJobToView(j *jobsmodel.FetchedJob) fetchedJobView {
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
