// working_nomads.go — Working Nomads exposed-jobs public API.
//
//	GET {base}/api/exposed_jobs/
//
// Returns a TOP-LEVEL array (no wrapper). Each job: title, company_name,
// category_name, tags (COMMA-SEPARATED string, not an array), location,
// pub_date (RFC3339 with TZ), description (HTML), url. There is no id field —
// we derive a stable one from the numeric segment in the url. No per-source
// config (single aggregate feed).

package fetch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const workingNomadsDefaultBase = "https://www.workingnomads.com"

type workingNomadsFetcher struct {
	client *http.Client
	base   string
}

func newWorkingNomadsFetcher(client *http.Client, envBase string) *workingNomadsFetcher {
	return &workingNomadsFetcher{
		client: client,
		base:   firstOrDefault(envBase, workingNomadsDefaultBase),
	}
}

func (f *workingNomadsFetcher) Fetch(
	ctx context.Context, _ []byte,
) ([]jobsmodel.FetchedJob, error) {
	url := f.base + "/api/exposed_jobs/"
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var raw []workingNomadsJob
	if uerr := json.Unmarshal(body, &raw); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(raw))
	for i := range raw {
		out = append(out, workingNomadsToDomain(&raw[i]))
	}
	return out, nil
}

type workingNomadsJob struct {
	Title       string `json:"title"`
	CompanyName string `json:"company_name"`
	Category    string `json:"category_name"`
	Tags        string `json:"tags"`
	Location    string `json:"location"`
	PubDate     string `json:"pub_date"`
	Description string `json:"description"`
	URL         string `json:"url"`
}

func workingNomadsToDomain(j *workingNomadsJob) jobsmodel.FetchedJob {
	return jobsmodel.FetchedJob{
		ExternalID:  firstNonEmpty(lastNumericSegment(j.URL), j.URL),
		Title:       j.Title,
		Company:     j.CompanyName,
		Location:    j.Location,
		URL:         j.URL,
		BodyText:    j.Description,
		Tags:        workingNomadsTags(j),
		PublishedAt: parseISOTime(j.PubDate),
		SourceKind:  KindWorkingNomads,
	}
}

func workingNomadsTags(j *workingNomadsJob) []string {
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, j.Category)
	for t := range strings.SplitSeq(j.Tags, ",") {
		tags = appendIfNonEmpty(tags, strings.TrimSpace(t))
	}
	return tags
}

// lastNumericSegment returns the last all-digit path segment of a URL
// (Working Nomads job URLs look like .../job/go/1826864/), or "" if none.
// Used as a stable external id since the feed carries no id field.
func lastNumericSegment(url string) string {
	segs := strings.Split(strings.Trim(url, "/"), "/")
	for _, s := range slices.Backward(segs) {
		if isAllDigits(s) {
			return s
		}
	}
	return ""
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
