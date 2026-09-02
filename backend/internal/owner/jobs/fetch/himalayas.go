// himalayas.go — Himalayas remote-jobs public API.
//
//	GET {base}/jobs/api?limit=50
//
// Returns {"jobs": [...]}. Each job: guid (URL string, used as the stable id),
// title, companyName, employmentType, description (HTML), pubDate (Unix epoch
// SECONDS, not ISO), locationRestrictions[], categories[], applicationLink.
// No per-source config (single aggregate feed).

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	himalayasDefaultBase = "https://himalayas.app"
	himalayasLimit       = 50
)

type himalayasFetcher struct {
	client *http.Client
	base   string
}

func newHimalayasFetcher(client *http.Client, envBase string) *himalayasFetcher {
	return &himalayasFetcher{client: client, base: firstOrDefault(envBase, himalayasDefaultBase)}
}

func (f *himalayasFetcher) Fetch(ctx context.Context, _ []byte) ([]jobsmodel.FetchedJob, error) {
	url := fmt.Sprintf("%s/jobs/api?limit=%d", f.base, himalayasLimit)
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var payload himalayasResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(payload.Jobs))
	for i := range payload.Jobs {
		out = append(out, himalayasToDomain(&payload.Jobs[i]))
	}
	return out, nil
}

type himalayasResp struct {
	Jobs []himalayasJob `json:"jobs"`
}

type himalayasJob struct {
	GUID                 string   `json:"guid"`
	Title                string   `json:"title"`
	CompanyName          string   `json:"companyName"`
	EmploymentType       string   `json:"employmentType"`
	Description          string   `json:"description"`
	ApplicationLink      string   `json:"applicationLink"`
	LocationRestrictions []string `json:"locationRestrictions"`
	Categories           []string `json:"categories"`
	PubDate              int64    `json:"pubDate"`
}

func himalayasToDomain(j *himalayasJob) jobsmodel.FetchedJob {
	var published time.Time
	if j.PubDate > 0 {
		published = time.Unix(j.PubDate, 0)
	}
	return jobsmodel.FetchedJob{
		ExternalID:  j.GUID,
		Title:       j.Title,
		Company:     j.CompanyName,
		Location:    strings.Join(j.LocationRestrictions, ", "),
		URL:         firstNonEmpty(j.ApplicationLink, j.GUID),
		BodyText:    j.Description,
		Tags:        himalayasTags(j),
		PublishedAt: published,
		SourceKind:  KindHimalayas,
	}
}

func himalayasTags(j *himalayasJob) []string {
	tags := make([]string, 0, len(j.Categories)+1)
	tags = appendIfNonEmpty(tags, j.EmploymentType)
	for _, c := range j.Categories {
		tags = appendIfNonEmpty(tags, c)
	}
	return tags
}
