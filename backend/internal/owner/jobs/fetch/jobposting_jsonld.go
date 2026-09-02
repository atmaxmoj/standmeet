// jobposting_jsonld.go — generic ingester for schema.org JobPosting JSON-LD.
//
// Sites that do Google-for-Jobs SEO embed a
// `<script type="application/ld+json">` block with @type JobPosting on each job
// DETAIL page. This one adapter reads that standard markup, so any long-tail
// board/careers site with the markup + a sitemap works with zero per-site code.
//
// Two config modes (a listing page never inlines postings in the wild, so there
// is no "one listing URL → many jobs" mode):
//
//	{"sitemap":"https://co.example/sitemap.xml","url_filter":"/jobs/"}  // enumerate detail URLs
//	{"urls":["https://co.example/jobs/123", ...]}                       // explicit detail URLs
//
// It is inherently N+1 (one fetch per posting), so it implements Accountant to
// report how many detail URLs were available, read, and skipped (and why).
//
// The big ATS (Greenhouse/Lever/Ashby/Recruitee/Workable) are better served by
// their own JSON APIs — one fetch returns every job — so those keep bespoke
// adapters; this covers the long tail.

package fetch

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// jsonLDMaxDetails caps how many detail pages one fetch will pull, so a large
// sitemap can't turn a single poll into thousands of requests.
const jsonLDMaxDetails = 60

// ldScriptRe matches <script type="application/ld+json"> ... </script>, case-
// insensitive, non-greedy, across newlines. It captures the inner JSON text.
var ldScriptRe = regexp.MustCompile(
	`(?is)<script[^>]*type=["']application/ld\+json["'][^>]*>(.*?)</script>`)

type jsonLDConfig struct {
	Sitemap   string   `json:"sitemap"`
	URLFilter string   `json:"url_filter"`
	URLs      []string `json:"urls"`
}

type jsonLDFetcher struct {
	client *http.Client
}

func newJSONLDFetcher(client *http.Client, _ string) *jsonLDFetcher {
	return &jsonLDFetcher{client: client}
}

// Fetch satisfies Fetcher; the Registry map is typed on it. The Accountant path
// (FetchAccounted) is what the registry actually prefers.
func (f *jsonLDFetcher) Fetch(ctx context.Context, cfgRaw []byte) ([]jobsmodel.FetchedJob, error) {
	acc, err := f.FetchAccounted(ctx, cfgRaw)
	if err != nil {
		return nil, err
	}
	return acc.Jobs, nil
}

// FetchAccounted resolves the detail URLs, fetches each, and pulls the
// JobPosting JSON-LD out. Skips (fetch failure, no JobPosting on the page) are
// counted by reason rather than silently dropped.
func (f *jsonLDFetcher) FetchAccounted(ctx context.Context, cfgRaw []byte) (Accounted, error) {
	cfg, err := parseJSONLDConfig(cfgRaw)
	if err != nil {
		return Accounted{}, err
	}
	urls, err := f.detailURLs(ctx, cfg)
	if err != nil {
		return Accounted{}, err
	}
	acc := Accounted{
		Skipped:   map[string]int{},
		Jobs:      make([]jobsmodel.FetchedJob, 0, len(urls)),
		Available: len(urls),
		Truncated: len(urls) > jsonLDMaxDetails,
	}
	for _, u := range capURLs(urls, jsonLDMaxDetails) {
		acc.Read++
		job, ok := f.fetchPosting(ctx, u, acc.Skipped)
		if ok {
			acc.Jobs = append(acc.Jobs, job)
		}
	}
	return acc, nil
}

// fetchPosting GETs one detail URL and extracts the first JobPosting on it. The
// page URL is the canonical job URL (JSON-LD never carries a top-level url).
func (f *jsonLDFetcher) fetchPosting(
	ctx context.Context, pageURL string, skipped map[string]int,
) (jobsmodel.FetchedJob, bool) {
	body, err := getBody(ctx, f.client, pageURL)
	if err != nil {
		skipped["fetch_failed"]++
		return jobsmodel.FetchedJob{}, false
	}
	posting, ok := firstJobPosting(body)
	if !ok {
		skipped["no_jobposting"]++
		return jobsmodel.FetchedJob{}, false
	}
	return jsonLDToDomain(&posting, pageURL), true
}

// detailURLs resolves the config into a concrete URL list: explicit urls, or the
// <loc> entries of a sitemap filtered by url_filter.
func (f *jsonLDFetcher) detailURLs(ctx context.Context, cfg jsonLDConfig) ([]string, error) {
	if len(cfg.URLs) > 0 {
		return cfg.URLs, nil
	}
	body, err := getBody(ctx, f.client, cfg.Sitemap)
	if err != nil {
		return nil, err
	}
	return sitemapLocs(body, cfg.URLFilter)
}

func capURLs(urls []string, limit int) []string {
	if len(urls) > limit {
		return urls[:limit]
	}
	return urls
}

// firstJobPosting scans every ld+json block on the page and returns the first
// object whose @type is JobPosting, unwrapping arrays and @graph containers.
func firstJobPosting(html []byte) (jsonLDPosting, bool) {
	for _, m := range ldScriptRe.FindAllSubmatch(html, -1) {
		if p, ok := jobPostingFromBlock(m[1]); ok {
			return p, true
		}
	}
	return jsonLDPosting{}, false
}

// jobPostingFromBlock parses one ld+json block (which may be a single object, an
// array, or {"@graph":[...]}) and returns the first JobPosting inside it. A
// malformed block yields (_, false) rather than aborting the caller's scan.
func jobPostingFromBlock(raw []byte) (jsonLDPosting, bool) {
	var node jsonLDNode
	if err := json.Unmarshal(raw, &node); err != nil {
		return jsonLDPosting{}, false
	}
	items := node.postings()
	for i := range items {
		if items[i].Type.has("JobPosting") {
			return items[i], true
		}
	}
	return jsonLDPosting{}, false
}

func jsonLDToDomain(p *jsonLDPosting, pageURL string) jobsmodel.FetchedJob {
	return jobsmodel.FetchedJob{
		ExternalID:  firstNonEmpty(p.Identifier.value(), pageURL),
		Title:       strings.TrimSpace(p.Title),
		Company:     p.HiringOrganization.Name,
		Location:    p.JobLocation.line(),
		URL:         pageURL,
		BodyText:    p.Description,
		Tags:        jsonLDTags(p),
		PublishedAt: parseFlexibleDate(p.DatePosted),
		SourceKind:  KindJobPostingJSONLD,
	}
}

func jsonLDTags(p *jsonLDPosting) []string {
	tags := make([]string, 0, defaultTagCap)
	for _, t := range p.EmploymentType.values() {
		tags = appendIfNonEmpty(tags, t)
	}
	if p.JobLocationType != "" {
		tags = appendIfNonEmpty(tags, p.JobLocationType)
	}
	return tags
}

func parseJSONLDConfig(raw []byte) (jsonLDConfig, error) {
	var cfg jsonLDConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("jsonld config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if cfg.Sitemap == "" && len(cfg.URLs) == 0 {
		return cfg, fmt.Errorf("jsonld needs a sitemap or urls: %w",
			jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

// validateJSONLDCfg — used by configValidators dispatch in jobfetch.go.
func validateJSONLDCfg(raw []byte) error {
	_, err := parseJSONLDConfig(raw)
	return err
}

// parseFlexibleDate reads schema.org datePosted, which is a bare date
// ("2026-04-07") on most sites and an RFC3339 timestamp on some.
func parseFlexibleDate(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

// sitemapLocs extracts <loc> URLs from a sitemap.xml, keeping only those that
// match the (optional) filter substring. An empty filter keeps every loc.
func sitemapLocs(body []byte, filter string) ([]string, error) {
	var sm sitemapXML
	if err := xml.Unmarshal(body, &sm); err != nil {
		return nil, fmt.Errorf("decode sitemap: %w: %w", ErrUpstreamSchema, err)
	}
	out := make([]string, 0, len(sm.URLs))
	for _, u := range sm.URLs {
		loc := strings.TrimSpace(u.Loc)
		if keepLoc(loc, filter) {
			out = append(out, loc)
		}
	}
	return out, nil
}

// keepLoc — a sitemap <loc> is kept when non-empty and (no filter, or it
// contains the filter substring).
func keepLoc(loc, filter string) bool {
	return loc != "" && (filter == "" || strings.Contains(loc, filter))
}

type sitemapXML struct {
	XMLName xml.Name     `xml:"urlset"`
	URLs    []sitemapURL `xml:"url"`
}

type sitemapURL struct {
	Loc string `xml:"loc"`
}
