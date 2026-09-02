// jobicy.go — Jobicy remote-jobs public API.
//
//	GET {base}/api/v2/remote-jobs?count=50
//
// Returns {"jobs": [...]}. Each job: id (int), jobTitle, companyName, jobGeo,
// url, jobExcerpt, jobDescription (HTML), pubDate (RFC3339 with TZ),
// jobIndustry[], jobType[]. No per-source config (single aggregate feed).

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	jobicyDefaultBase = "https://jobicy.com"
	// jobicyCount — the feed caps ?count at 50; ask for the max in one pull.
	jobicyCount = 50
)

type jobicyFetcher struct {
	client *http.Client
	base   string
}

func newJobicyFetcher(client *http.Client, envBase string) *jobicyFetcher {
	return &jobicyFetcher{client: client, base: firstOrDefault(envBase, jobicyDefaultBase)}
}

func (f *jobicyFetcher) Fetch(ctx context.Context, _ []byte) ([]jobsmodel.FetchedJob, error) {
	url := fmt.Sprintf("%s/api/v2/remote-jobs?count=%d", f.base, jobicyCount)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload jobicyResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, jobicyToDomain(&payload.Jobs[i]))
	}
	return out, nil
}

type jobicyResp struct {
	Jobs []jobicyJob `json:"jobs"`
}

type jobicyJob struct {
	JobTitle    string   `json:"jobTitle"`
	CompanyName string   `json:"companyName"`
	JobGeo      string   `json:"jobGeo"`
	URL         string   `json:"url"`
	Description string   `json:"jobDescription"`
	PubDate     string   `json:"pubDate"`
	JobIndustry []string `json:"jobIndustry"`
	JobType     []string `json:"jobType"`
	ID          int64    `json:"id"`
}

func jobicyToDomain(j *jobicyJob) jobsmodel.FetchedJob {
	return jobsmodel.FetchedJob{
		ExternalID:  strconv.FormatInt(j.ID, decimalRadix),
		Title:       j.JobTitle,
		Company:     j.CompanyName,
		Location:    j.JobGeo,
		URL:         j.URL,
		BodyText:    j.Description,
		Tags:        jobicyTags(j),
		PublishedAt: parseISOTime(j.PubDate),
		SourceKind:  KindJobicy,
	}
}

func jobicyTags(j *jobicyJob) []string {
	tags := make([]string, 0, len(j.JobIndustry)+len(j.JobType))
	for _, t := range j.JobIndustry {
		tags = appendIfNonEmpty(tags, t)
	}
	for _, t := range j.JobType {
		tags = appendIfNonEmpty(tags, t)
	}
	return tags
}
