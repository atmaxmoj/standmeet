// new_sources_test.go — parse contracts for the aggregator + Recruitee adapters
// added 2026-09. Each feeds a fixture shaped like the real upstream response
// through the adapter and asserts the FetchedJob mapping (id, title, company,
// location, tags, published, source kind) — the adapter's whole job. httptest
// stands in for the upstream so no network is touched.

package fetch

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// serveFetch spins an httptest server returning `body` for any path, points the
// adapter's base at it, runs Fetch, and returns the mapped jobs.
func serveFetch(
	t *testing.T,
	body string,
	build func(client *http.Client, base string) Fetcher,
	cfg []byte,
) []jobsFetched {
	t.Helper()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(body)) //nolint:errcheck // test server; a write error is not the SUT
	}))
	t.Cleanup(ts.Close)
	jobs, err := build(ts.Client(), ts.URL).Fetch(context.Background(), cfg)
	require.NoError(t, err)
	out := make([]jobsFetched, 0, len(jobs))
	for i := range jobs {
		out = append(out, jobsFetched{
			ID: jobs[i].ExternalID, Title: jobs[i].Title, Company: jobs[i].Company,
			Location: jobs[i].Location, URL: jobs[i].URL, Body: jobs[i].BodyText,
			Tags: jobs[i].Tags, Kind: jobs[i].SourceKind,
			PublishedZero: jobs[i].PublishedAt.IsZero(),
		})
	}
	return out
}

// jobsFetched — a flattened view of FetchedJob so assertions read plainly.
type jobsFetched struct {
	ID, Title, Company, Location, URL, Body, Kind string
	Tags                                          []string
	PublishedZero                                 bool
}

func TestJobicyParsesFeed(t *testing.T) {
	t.Parallel()
	const body = `{"jobs":[{"id":42,"jobTitle":"Staff Engineer","companyName":"Acme",
		"jobGeo":"Anywhere","url":"https://jobicy.com/j/42","jobDescription":"<p>build</p>",
		"pubDate":"2026-09-01T14:57:25+00:00","jobIndustry":["Engineering"],
		"jobType":["full-time"]}]}`
	jobs := serveFetch(t, body, func(c *http.Client, base string) Fetcher {
		return newJobicyFetcher(c, base)
	}, nil)
	require.Len(t, jobs, 1)
	require.Equal(t, "42", jobs[0].ID)
	require.Equal(t, "Staff Engineer", jobs[0].Title)
	require.Equal(t, "Acme", jobs[0].Company)
	require.Equal(t, KindJobicy, jobs[0].Kind)
	require.Subset(t, jobs[0].Tags, []string{"Engineering", "full-time"})
	require.False(t, jobs[0].PublishedZero, "RFC3339 pubDate must parse")
}

func TestRemotiveParsesTimezonelessDate(t *testing.T) {
	t.Parallel()
	// publication_date has NO timezone — the adapter must still parse it (RFC3339 can't).
	const body = `{"jobs":[{"id":7,"title":"Backend Dev","company_name":"Globex","category":"Dev",
		"job_type":"contract","publication_date":"2026-08-27T14:36:09",
		"candidate_required_location":"USA","url":"https://remotive.com/j/7",
		"description":"<p>hi</p>","tags":["go","rust"]}]}`
	jobs := serveFetch(t, body, func(c *http.Client, base string) Fetcher {
		return newRemotiveFetcher(c, base)
	}, nil)
	require.Len(t, jobs, 1)
	require.Equal(t, "7", jobs[0].ID)
	require.Equal(t, "USA", jobs[0].Location)
	require.Equal(t, KindRemotive, jobs[0].Kind)
	require.Subset(t, jobs[0].Tags, []string{"Dev", "contract", "go", "rust"})
	require.False(t, jobs[0].PublishedZero, "timezoneless date must still parse")
}

func TestHimalayasParsesUnixDateAndGUID(t *testing.T) {
	t.Parallel()
	const body = `{"jobs":[{"guid":"https://himalayas.app/j/9","title":"SRE",
		"companyName":"Initech","employmentType":"Full Time","description":"<p>ops</p>",
		"applicationLink":"https://apply/9","locationRestrictions":["US","CA"],
		"categories":["Infra"],"pubDate":1756744645}]}`
	jobs := serveFetch(t, body, func(c *http.Client, base string) Fetcher {
		return newHimalayasFetcher(c, base)
	}, nil)
	require.Len(t, jobs, 1)
	require.Equal(t, "https://himalayas.app/j/9", jobs[0].ID, "guid is the external id")
	require.Equal(t, "US, CA", jobs[0].Location, "location restrictions joined")
	require.Equal(t, "https://apply/9", jobs[0].URL)
	require.Subset(t, jobs[0].Tags, []string{"Full Time", "Infra"})
	require.False(t, jobs[0].PublishedZero, "unix pubDate must parse")
}

func TestWorkingNomadsDerivesIDAndSplitsTags(t *testing.T) {
	t.Parallel()
	// Top-level array, no id (derive from URL), tags is a comma-separated string.
	const body = `[{"title":"Data Eng","company_name":"Hooli","category_name":"Data",
		"tags":"python, sql","location":"WORLDWIDE","pub_date":"2026-08-01T10:00:00+00:00",
		"description":"<p>data</p>","url":"https://www.workingnomads.com/job/go/1826864/"}]`
	jobs := serveFetch(t, body, func(c *http.Client, base string) Fetcher {
		return newWorkingNomadsFetcher(c, base)
	}, nil)
	require.Len(t, jobs, 1)
	require.Equal(t, "1826864", jobs[0].ID, "id derived from the URL's numeric segment")
	require.Equal(t, KindWorkingNomads, jobs[0].Kind)
	require.Subset(t, jobs[0].Tags, []string{"Data", "python", "sql"})
	require.False(t, jobs[0].PublishedZero)
}

func TestRecruiteeParsesOffersAndNeedsCompany(t *testing.T) {
	t.Parallel()
	const body = `{"offers":[{"id":5,"title":"PM","description":"<p>lead</p>",
		"requirements":"<p>5y</p>","company_name":"Umbrella",
		"careers_url":"https://u.recruitee.com/o/5","published_at":"2026-07-01T00:00:00Z",
		"department":"Product","employment_type_code":"full_time","tags":["remote"],
		"locations":[{"city":"Berlin","country":"Germany"}]}]}`
	jobs := serveFetch(t, body, func(c *http.Client, base string) Fetcher {
		return newRecruiteeFetcher(c, base)
	}, []byte(`{"company":"umbrella"}`))
	require.Len(t, jobs, 1)
	require.Equal(t, "5", jobs[0].ID)
	require.Equal(t, "Berlin, Germany", jobs[0].Location)
	require.Contains(t, jobs[0].Body, "lead")
	require.Contains(t, jobs[0].Body, "5y", "description and requirements are both carried")
	require.Subset(t, jobs[0].Tags, []string{"Product", "full_time", "remote"})

	// Config is mandatory: no company → rejected before any request.
	require.Error(t, validateRecruiteeCfg([]byte(`{}`)), "recruitee needs a company")
	require.NoError(t, validateRecruiteeCfg([]byte(`{"company":"x"}`)))
}
