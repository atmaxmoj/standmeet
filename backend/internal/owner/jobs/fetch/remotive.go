// remotive.go — Remotive remote-jobs public API.
//
//	GET {base}/api/remote-jobs
//
// Returns {"jobs": [...]}. Each job: id (int), title, company_name, category,
// tags[], job_type, publication_date (ISO 8601 WITHOUT a timezone), url,
// candidate_required_location, salary, description (HTML). No per-source config.
//
// Remotive's payload carries a legal notice asking callers to cache rather than
// poll hard; the job loop already fetches on demand (a few pulls/day), so no
// extra throttling here.

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const remotiveDefaultBase = "https://remotive.com"

// remotiveTimeLayout — Remotive stamps publication_date without a timezone
// (e.g. "2026-08-27T14:36:09"), so RFC3339 (which requires one) can't read it.
const remotiveTimeLayout = "2006-01-02T15:04:05"

type remotiveFetcher struct {
	client *http.Client
	base   string
}

func newRemotiveFetcher(client *http.Client, envBase string) *remotiveFetcher {
	return &remotiveFetcher{client: client, base: firstOrDefault(envBase, remotiveDefaultBase)}
}

func (f *remotiveFetcher) Fetch(ctx context.Context, _ []byte) ([]jobsmodel.FetchedJob, error) {
	url := f.base + "/api/remote-jobs"
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload remotiveResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, remotiveToDomain(&payload.Jobs[i]))
	}
	return out, nil
}

type remotiveResp struct {
	Jobs []remotiveJob `json:"jobs"`
}

type remotiveJob struct {
	Title       string   `json:"title"`
	CompanyName string   `json:"company_name"`
	Category    string   `json:"category"`
	JobType     string   `json:"job_type"`
	PubDate     string   `json:"publication_date"`
	Location    string   `json:"candidate_required_location"`
	URL         string   `json:"url"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	ID          int64    `json:"id"`
}

func remotiveToDomain(j *remotiveJob) jobsmodel.FetchedJob {
	var published time.Time
	if t, err := time.Parse(remotiveTimeLayout, j.PubDate); err == nil {
		published = t
	}
	return jobsmodel.FetchedJob{
		ExternalID:  strconv.FormatInt(j.ID, decimalRadix),
		Title:       j.Title,
		Company:     j.CompanyName,
		Location:    j.Location,
		URL:         j.URL,
		BodyText:    j.Description,
		Tags:        remotiveTags(j),
		PublishedAt: published,
		SourceKind:  KindRemotive,
	}
}

func remotiveTags(j *remotiveJob) []string {
	tags := make([]string, 0, len(j.Tags)+defaultTagCap)
	tags = appendIfNonEmpty(tags, j.Category)
	tags = appendIfNonEmpty(tags, j.JobType)
	for _, t := range j.Tags {
		tags = appendIfNonEmpty(tags, t)
	}
	return tags
}
