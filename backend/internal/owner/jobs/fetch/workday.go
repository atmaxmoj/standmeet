// workday.go — Workday CXS (Candidate eXperience Service) public jobs
// endpoint. Each tenant hosts its own instance at wd{N}.myworkdayjobs.com,
// where N is the data center (wd1/wd3/wd5/...); it cannot be assumed fixed.
//
//	POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
//	Content-Type: application/json
//	body: {"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
//
// Returns {"total": N, "jobPostings": [{title, locationsText, externalPath,
// postedOn, ...}]}. limit 20 is the endpoint's default; set max_jobs in cfg
// to paginate further.
//
// The adapter stops at the first page (limit=100 per page is enough for
// most small companies); pagination is left for a later J-phase
// optimization. The JBA scraper does multi-page + retry because it scrapes
// the whole collection; an owner's personal source is fine with one page.

package fetch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	workdayDefaultHostPattern = "https://%s.wd%s.myworkdayjobs.com"
	// workdayPageLimit — **the vendor's per-page cap, not our preference**. Measured
	// once on each of two real tenants on 2026-08-16: `redhat` / `nvidia`,
	// `limit:20` → 200, **`limit:21` → 400**. This used to be set to 100, so
	// **every real Workday fetch was a 400**, while the mock accepts any limit,
	// so CI stayed green (F-E-15).
	workdayPageLimit = 20
	// workdayMaxPages — hard cap on pagination. On real Workday, total can reach
	// the thousands (nvidia: 2000); an owner's source shouldn't drag back an
	// entire company's job listings. Stop at the cap and **say so** (see the log
	// line below).
	workdayMaxPages = 25
)

type workdayConfig struct {
	Tenant string `json:"tenant"`
	WD     string `json:"wd"`
	Site   string `json:"site"`
}

type workdayFetcher struct {
	client  *http.Client
	envBase string
}

func newWorkdayFetcher(client *http.Client, envBase string) *workdayFetcher {
	return &workdayFetcher{client: client, envBase: envBase}
}

// Fetch walks the CXS jobs query to the END of the collection.
//
// Each page tops out at 20 rows (vendor-set), while real tenants routinely run
// into the hundreds or thousands (`redhat` 149 / `salesforce` 1514 / `nvidia`
// 2000), so "fetched page one" and "this company only has this many jobs" look
// identical in the result — that's exactly the silent truncation F-E-16 guards
// against. Three termination conditions, all required: `total` fully collected,
// a page comes back empty, or we hit `workdayMaxPages` (hitting it logs a line,
// so truncation never happens quietly).
func (f *workdayFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := parseWorkdayConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	u := f.buildURL(&cfg)
	walk := &workdayWalk{out: make([]jobsmodel.FetchedJob, 0, workdayPageLimit)}
	for page := range workdayMaxPages {
		if perr := f.walkPage(ctx, &u, cfg.Tenant, page, walk); perr != nil {
			return nil, perr
		}
		if walk.done() {
			return walk.out, nil
		}
	}
	// Getting here means we hit the page cap before finishing. Return what
	// we already have, but log it — "got part of it" must not look like
	// "that's all there is" (no silent caps).
	slog.WarnContext(ctx, "workday page cap reached; result is partial",
		"url", u.jobsURL, "pages", workdayMaxPages, "fetched", len(walk.out))
	return walk.out, nil
}

// workdayWalk — state for one paging walk: what's collected so far, the row
// count of the most recent page, and the total reported by **page one**.
type workdayWalk struct {
	out   []jobsmodel.FetchedJob
	got   int
	total int
}

// done — have we reached the end. **A short page is the only reliable
// end-of-data signal**: a page that doesn't fill limit means there's nothing
// after it.
//
// `total` is trusted only from **page one** (see walkPage) — real Workday
// reports it as 0 on subsequent pages (nvidia, 2026-08-16: `offset=0` →
// `total:2000`, `offset=20/40/60` → `total:0`, while each page still returns
// 20 rows). This used to judge by each page's own total, so the 0 on page two
// made `len(out) >= 0` always true, and 2000 rows came back as only 40 — **a
// silent truncation harder to catch than that 400** — and it happened to stay
// green when the fixture had 25 rows (page two was coincidentally a short
// page). The fixture was changed to 45 rows specifically to force this out.
func (w *workdayWalk) done() bool {
	return w.got < workdayPageLimit || (w.total > 0 && len(w.out) >= w.total)
}

// walkPage — fetches page `page`, maps it into walk.out, and records "how
// many rows this page had / page one's total" into state.
func (f *workdayFetcher) walkPage(
	ctx context.Context, u *workdayURL, tenant string, page int, walk *workdayWalk,
) error {
	body, err := f.postQuery(ctx, u.jobsURL, u.host, page*workdayPageLimit)
	if err != nil {
		return err
	}
	var payload workdayResp
	if uerr := json.Unmarshal(body, &payload); uerr != nil {
		return fmt.Errorf("decode %s: %w: %w", u.jobsURL, ErrUpstreamSchema, uerr)
	}
	for i := range payload.JobPostings {
		walk.out = append(walk.out, workdayToDomain(&payload.JobPostings[i], u.host, tenant))
	}
	walk.got = len(payload.JobPostings)
	if page == 0 {
		walk.total = payload.Total
	}
	return nil
}

// workdayURL pairs the (host, jobs URL) Workday's CXS endpoint needs:
// host goes into the Origin request header and prefixes the per-job URL;
// jobsURL is what we POST to.
type workdayURL struct {
	host    string
	jobsURL string
}

func (f *workdayFetcher) buildURL(cfg *workdayConfig) workdayURL {
	host := f.envBase
	if host == "" {
		host = fmt.Sprintf(workdayDefaultHostPattern, cfg.Tenant, cfg.WD)
	}
	jobsURL := fmt.Sprintf("%s/wday/cxs/%s/%s/jobs", host, cfg.Tenant, cfg.Site)
	return workdayURL{host: host, jobsURL: jobsURL}
}

// postQuery — Workday CXS needs a POST with a JSON body. The shared getBody
// is GET-only; build the request and inline the status check separately,
// the handler closes the response body itself.
func (f *workdayFetcher) postQuery(
	ctx context.Context, url, host string, offset int,
) ([]byte, error) {
	payload := []byte(
		`{"appliedFacets":{},"limit":` +
			strconv.Itoa(workdayPageLimit) +
			`,"offset":` + strconv.Itoa(offset) +
			`,"searchText":""}`,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", defaultUserAgent)
	req.Header.Set("Origin", host)
	resp, derr := f.client.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("%s: %w: %w", url, ErrUpstream, derr)
	}
	defer closeQuiet(resp.Body)
	return readOK(resp, url)
}

func parseWorkdayConfig(raw []byte) (workdayConfig, error) {
	var cfg workdayConfig
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return cfg, fmt.Errorf("workday config decode: %w: %w",
				jobsmodel.ErrJobSourceConfigInvalid, err)
		}
	}
	if missing := firstMissingWorkdayField(&cfg); missing != "" {
		return cfg, fmt.Errorf("workday missing %s: %w",
			missing, jobsmodel.ErrJobSourceConfigInvalid)
	}
	return cfg, nil
}

func firstMissingWorkdayField(cfg *workdayConfig) string {
	for _, f := range []struct {
		name, value string
	}{
		{"tenant", cfg.Tenant},
		{"wd", cfg.WD},
		{"site", cfg.Site},
	} {
		if f.value == "" {
			return f.name
		}
	}
	return ""
}

func validateWorkdayCfg(raw []byte) error {
	_, err := parseWorkdayConfig(raw)
	return err
}

type workdayResp struct {
	JobPostings []workdayJob `json:"jobPostings"`
	Total       int          `json:"total"`
}

// workdayJob — declares only the fields **we actually use**.
//
// There used to be a `BulletFields string` here too, which nothing read, while
// real Workday sends an **array** (`"bulletFields":["R-12345"]`, hit on nvidia
// on 2026-08-16) — so an unused field broke decoding of the entire response:
// *"cannot unmarshal array into Go struct field workdayJob.jobPostings.bulletFields"*.
// Declaring a field is signing a contract; don't sign fields we don't use
// (`encoding/json` silently skips undeclared keys).
type workdayJob struct {
	Title         string `json:"title"`
	LocationsText string `json:"locationsText"`
	ExternalPath  string `json:"externalPath"`
	PostedOn      string `json:"postedOn"`
}

func workdayToDomain(j *workdayJob, host, tenant string) jobsmodel.FetchedJob {
	url := host + j.ExternalPath
	// externalPath looks like /en-US/{site}/job/.../R-12345; ExternalID = the
	// final path segment, stable and unique across the tenant. Falls back to
	// the full path.
	externalID := j.ExternalPath
	if idx := strings.LastIndex(j.ExternalPath, "/"); idx >= 0 && idx < len(j.ExternalPath)-1 {
		externalID = j.ExternalPath[idx+1:]
	}
	// Workday uses a natural-language string like "Posted N Days Ago" rather
	// than ISO; PublishedAt is left as zero for now (the caller's sort
	// tolerates zero time). Add a relative-time parser later in J-phase if
	// sorting by date is actually needed.
	return jobsmodel.FetchedJob{
		ExternalID:  externalID,
		Title:       j.Title,
		Company:     tenant,
		Location:    j.LocationsText,
		URL:         url,
		PublishedAt: time.Time{},
		SourceKind:  KindWorkday,
	}
}
