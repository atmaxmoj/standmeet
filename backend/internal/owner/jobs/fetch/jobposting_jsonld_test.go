// jobposting_jsonld_test.go — the generic JSON-LD ingester's whole value is
// robust parsing of the varied real shapes, so these pin: object-vs-array
// jobLocation, string-vs-int identifier, @graph wrappers, @type arrays, multiple
// ld+json blocks per page (pick the JobPosting), the sitemap and urls config
// modes, and skip accounting. Fixtures mirror real Ashby/Lever/Recruitee/
// Teamtailor payloads observed on live pages.

package fetch

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func pageWith(ld string) string {
	return `<html><head><script type="application/ld+json">` + ld +
		`</script></head><body>job</body></html>`
}

// mapLD runs the page-level extraction + mapping the adapter does per detail page.
func mapLD(t *testing.T, html, pageURL string) (jobsFetched, bool) {
	t.Helper()
	posting, ok := firstJobPosting([]byte(html))
	if !ok {
		return jobsFetched{}, false
	}
	j := jsonLDToDomain(&posting, pageURL)
	return jobsFetched{
		ID: j.ExternalID, Title: j.Title, Company: j.Company, Location: j.Location,
		URL: j.URL, Body: j.BodyText, Tags: j.Tags, Kind: j.SourceKind,
		PublishedZero: j.PublishedAt.IsZero(),
	}, true
}

const ashbyLD = `{"@context":"https://schema.org/","@type":"JobPosting",
	"title":" Security Engineer","description":"<p>about ramp</p>",
	"identifier":{"@type":"PropertyValue","value":"uuid-1"},"datePosted":"2026-04-07",
	"hiringOrganization":{"@type":"Organization","name":"Ramp"},
	"jobLocation":{"@type":"Place","address":{"@type":"PostalAddress",
	"addressLocality":"New York City","addressRegion":"NY","addressCountry":"USA"}},
	"employmentType":"FULL_TIME","jobLocationType":"TELECOMMUTE"}`

// Recruitee: jobLocation is an ARRAY, identifier.value is an INTEGER, context is http.
const recruiteeLD = `{"@context":"http://schema.org","@type":"JobPosting","title":"PM",
	"employmentType":"FULL_TIME","datePosted":"2026-08-28",
	"identifier":{"@type":"PropertyValue","value":2726129},
	"hiringOrganization":{"name":"Deerns"},
	"jobLocation":[{"@type":"Place","address":{"addressLocality":"Den Haag",
	"addressRegion":"ZH","addressCountry":"NL"}}]}`

func TestJSONLD_ObjectLocationAndStringID(t *testing.T) {
	t.Parallel()
	got, ok := mapLD(t, pageWith(ashbyLD), "https://jobs.ashbyhq.com/ramp/uuid-1")
	require.True(t, ok)
	require.Equal(t, "uuid-1", got.ID)
	require.Equal(t, "Security Engineer", got.Title, "leading space trimmed")
	require.Equal(t, "Ramp", got.Company)
	require.Equal(t, "New York City, NY, USA", got.Location, "object jobLocation")
	require.Equal(t, "https://jobs.ashbyhq.com/ramp/uuid-1", got.URL, "page URL is the job URL")
	require.Subset(t, got.Tags, []string{"FULL_TIME", "TELECOMMUTE"})
	require.False(t, got.PublishedZero, "bare date parses")
}

func TestJSONLD_ArrayLocationAndIntID(t *testing.T) {
	t.Parallel()
	got, ok := mapLD(t, pageWith(recruiteeLD), "https://x.recruitee.com/o/5")
	require.True(t, ok)
	require.Equal(t, "2726129", got.ID, "integer identifier.value coerced to string")
	require.Equal(t, "Den Haag, ZH, NL", got.Location, "array jobLocation → first place")
}

func TestJSONLD_GraphWrapperPicksJobPosting(t *testing.T) {
	t.Parallel()
	const graph = `{"@context":"https://schema.org","@graph":[
		{"@type":"Organization","name":"NotThis"},
		{"@type":"JobPosting","title":"SRE","hiringOrganization":{"name":"Initech"},
		"datePosted":"2026-07-01"}]}`
	got, ok := mapLD(t, pageWith(graph), "https://co/j/1")
	require.True(t, ok)
	require.Equal(t, "SRE", got.Title)
	require.Equal(t, "Initech", got.Company, "the JobPosting node, not the Organization")
}

func TestJSONLD_TypeArrayAndMultipleBlocks(t *testing.T) {
	t.Parallel()
	// First block is an Organization; the JobPosting (with @type as an ARRAY) is second.
	html := `<html><head>` +
		`<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>` +
		`<script type="application/ld+json">{"@type":["JobPosting"],"title":"Data",` +
		`"hiringOrganization":{"name":"Hooli"},"datePosted":"2026-08-01"}</script>` +
		`</head></html>`
	got, ok := mapLD(t, html, "https://co/j/2")
	require.True(t, ok, "scans past the Organization block to the JobPosting")
	require.Equal(t, "Data", got.Title)
}

func TestJSONLD_NoJobPostingIsSkipped(t *testing.T) {
	t.Parallel()
	_, ok := mapLD(t, pageWith(`{"@type":"Organization","name":"X"}`), "https://co/about")
	require.False(t, ok, "a page with no JobPosting yields nothing")
}

func TestJSONLD_FetchViaURLsAccounts(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/missing" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(pageWith(ashbyLD))) //nolint:errcheck // test server
	}))
	t.Cleanup(ts.Close)
	cfg := fmt.Sprintf(`{"urls":["%s/jobs/1","%s/missing"]}`, ts.URL, ts.URL)
	acc, err := newJSONLDFetcher(ts.Client(), "").FetchAccounted(context.Background(), []byte(cfg))
	require.NoError(t, err)
	require.Len(t, acc.Jobs, 1, "the good URL yields a job")
	require.Equal(t, 2, acc.Available)
	require.Equal(t, 2, acc.Read)
	require.Equal(t, 1, acc.Skipped["fetch_failed"], "the 404 is accounted, not silently dropped")
}

func TestJSONLD_FetchViaSitemapFilters(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	mux.HandleFunc("/sitemap.xml", func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		body := fmt.Sprintf(`<urlset><url><loc>%s/jobs/1</loc></url>`+
			`<url><loc>%s/jobs/2</loc></url><url><loc>%s/about</loc></url></urlset>`,
			base, base, base)
		_, _ = w.Write([]byte(body)) //nolint:errcheck // test server
	})
	mux.HandleFunc("/jobs/", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(pageWith(ashbyLD))) //nolint:errcheck // test server
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	cfg := fmt.Sprintf(`{"sitemap":"%s/sitemap.xml","url_filter":"/jobs/"}`, ts.URL)
	acc, err := newJSONLDFetcher(ts.Client(), "").FetchAccounted(context.Background(), []byte(cfg))
	require.NoError(t, err)
	require.Equal(t, 2, acc.Available, "the /about loc is filtered out by url_filter")
	require.Len(t, acc.Jobs, 2)
}

func TestJSONLD_ConfigRequiresSitemapOrURLs(t *testing.T) {
	t.Parallel()
	require.Error(t, validateJSONLDCfg([]byte(`{}`)), "needs a sitemap or urls")
	require.NoError(t, validateJSONLDCfg([]byte(`{"sitemap":"https://x/s.xml"}`)))
	require.NoError(t, validateJSONLDCfg([]byte(`{"urls":["https://x/j/1"]}`)))
}
