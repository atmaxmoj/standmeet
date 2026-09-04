// Package fetch —— job source fetcher adapters. Each adapter knows the concrete API
// shape of one ATS or job board (URL pattern, JSON shape, field mapping), and all of
// them output a uniform jobsmodel.FetchedJob array.
//
// Starting at the J phase this moves into plugins/jobs/fetch/, as the jobs plugin's
// fetch sub-package.
//
// Each adapter's base URL is overridable via env: production sets no env and uses the
// real const URL; e2e/dev point the env at the external-mock container docker compose
// starts.
//
// See docs/design/job-loop.md, the "state division of labor" decision L.1: StandMeet
// does not reason about a job / score it / rank it — an adapter only outputs, as-is,
// "what jobs this source has right now".
//
// **Config shape**: what register_source passes up is a schemaless object; it gets
// marshaled to JSON bytes at write time; the fetcher receives []byte and, as its
// first move, unmarshals into its own typed struct. This keeps the domain / fetch
// boundary free of `any`.
package fetch

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/plaintext"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// Source kind strings —— aligned with the schema CHECK constraint + register_source input.
const (
	KindGreenhouse      = "greenhouse"
	KindLever           = "lever"
	KindAshby           = "ashby"
	KindRemoteOK        = "remoteok"
	KindWWR             = "wwr"
	KindHNHiring        = "hn_hiring"
	KindSmartRecruiters = "smartrecruiters"
	KindWorkable        = "workable"
	// KindJBA —— J.6a: JobBoardAggregator (Feashliaa) aggregated source; see jba.go for details.
	KindJBA = "jba"
	// KindWorkday / KindBambooHR —— J.6b: two direct ATS adapters (same strategy as
	// greenhouse); do not depend on JBA.
	KindWorkday  = "workday"
	KindBambooHR = "bamboohr"
	// KindJobicy / KindRemotive / KindHimalayas / KindWorkingNomads — remote-jobs
	// aggregators (single public feed, no per-source config).
	KindJobicy        = "jobicy"
	KindRemotive      = "remotive"
	KindHimalayas     = "himalayas"
	KindWorkingNomads = "working_nomads"
	// KindRecruitee — per-company ATS (public Careers Site API), like greenhouse.
	KindRecruitee = "recruitee"
	// KindJobPostingJSONLD — generic long-tail ingester: parses schema.org
	// JobPosting JSON-LD off detail pages (config carries a sitemap or urls).
	KindJobPostingJSONLD = "jobposting_jsonld"
	// KindRSS — generic RSS 2.0 feed adapter (config: feed_url). ONE adapter covers the long
	// tail of niche boards that expose an RSS feed; each board is a seeded source, no bespoke code.
	KindRSS = "rss"
)

const (
	defaultHTTPTimeout = 20 * time.Second
	defaultUserAgent   = "StandMeet/0.1 (+https://github.com/atmaxmoj/standmeet)"
	// defaultTagCap —— common starting capacity for per-job tag slices
	// (most adapters emit 3-4 tags; pre-sizing keeps append() amortised).
	defaultTagCap = 4
	// decimalRadix —— strconv.FormatInt base 10. Named so revive add-constant
	// stops complaining and the call sites read with intent.
	decimalRadix = 10
)

// Fetcher —— the contract for a single source kind. Caller passes raw config bytes
// (per-kind schema); the adapter internally unmarshals to a typed struct, builds the
// URL, GETs, and parses.
type Fetcher interface {
	Fetch(ctx context.Context, cfgRaw []byte) ([]jobsmodel.FetchedJob, error)
}

// Accountant —— an **optional** implementation: an adapter accounts for whatever
// trade-offs it made internally on this run.
//
// Why optional: most adapters make one request and get back everything the upstream
// gave, so there's no internal trade-off to account for. But **sources fetched item
// by item** (HN, one request per comment) are different — they skip ones that failed
// to fetch, skip ones that were deleted, and stop once they hit a count cap, and all
// three of these look identical in a `[]FetchedJob`: the count is just smaller.
// In a real environment this produced "262 comments went in, 1 came out, with nothing
// anywhere saying why" (F-E-19).
//
// The Registry prefers this path for any adapter that implements it; adapters that
// don't still go through Fetch as before.
type Accountant interface {
	FetchAccounted(ctx context.Context, cfgRaw []byte) (Accounted, error)
}

// Accounted —— the ledger for one fetch run: what we got + how much the upstream
// says exists in total + how much we looked at + how much was skipped and why.
//
// `Available` is the total **the upstream itself reports** (0 when it doesn't say);
// `Read` is how many entries we actually walked through; `Skipped` is counted
// per-reason — "failed to fetch" and "this one was deleted" must stay separate,
// collapsing them into one number is the same as not counting at all (that's exactly
// what caused F-E-19).
type Accounted struct {
	Skipped   map[string]int
	Jobs      []jobsmodel.FetchedJob
	Available int
	Read      int
	Truncated bool
}

// Registry —— the kind → Fetcher registry. usecases dispatch through this.
type Registry struct {
	fetchers map[string]Fetcher
}

// BaseURLs —— per-adapter base URL overrides. Any empty string falls back to the real
// const URL. e2e resolves these from env when it starts the backend.
type BaseURLs struct {
	Greenhouse      string
	Lever           string
	Ashby           string
	RemoteOK        string
	WWR             string
	HN              string
	SmartRecruiters string
	Workable        string
	JBA             string
	Workday         string
	BambooHR        string
	Jobicy          string
	Remotive        string
	Himalayas       string
	WorkingNomads   string
	Recruitee       string
}

// New constructs a Registry. BaseURLs can be set individually (e2e mocks plug in fake
// server addresses); any zero string falls back to the real const URL.
func New(b *BaseURLs) *Registry {
	if b == nil {
		b = &BaseURLs{}
	}
	client := httpx.NewClient(httpx.Options{Timeout: defaultHTTPTimeout})
	return &Registry{
		fetchers: map[string]Fetcher{
			KindGreenhouse:       newGreenhouseFetcher(client, b.Greenhouse),
			KindLever:            newLeverFetcher(client, b.Lever),
			KindAshby:            newAshbyFetcher(client, b.Ashby),
			KindRemoteOK:         newRemoteOKFetcher(client, b.RemoteOK),
			KindWWR:              newWWRFetcher(client, b.WWR),
			KindHNHiring:         newHNHiringFetcher(client, b.HN),
			KindSmartRecruiters:  newSmartRecruitersFetcher(client, b.SmartRecruiters),
			KindWorkable:         newWorkableFetcher(client, b.Workable),
			KindJBA:              newJBAFetcher(client, b.JBA),
			KindWorkday:          newWorkdayFetcher(client, b.Workday),
			KindBambooHR:         newBambooHRFetcher(client, b.BambooHR),
			KindJobicy:           newJobicyFetcher(client, b.Jobicy),
			KindRemotive:         newRemotiveFetcher(client, b.Remotive),
			KindHimalayas:        newHimalayasFetcher(client, b.Himalayas),
			KindWorkingNomads:    newWorkingNomadsFetcher(client, b.WorkingNomads),
			KindRecruitee:        newRecruiteeFetcher(client, b.Recruitee),
			KindJobPostingJSONLD: newJSONLDFetcher(client, ""),
			KindRSS:              newRSSFetcher(client),
		},
	}
}

// Fetch routes by kind to the matching adapter. Returns jobsmodel.ErrJobSourceKindInvalid
// when the kind is unrecognized.
func (r *Registry) Fetch(
	ctx context.Context, kind string, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	acc, err := r.FetchAccounted(ctx, kind, cfgRaw)
	if err != nil {
		return nil, err
	}
	return acc.Jobs, nil
}

// FetchAccounted —— the same path as Fetch, but **brings the ledger back too**. An
// adapter implementing Accountant takes its own path; for one that doesn't, the
// ledger is simply "got N, read N, nothing skipped".
func (r *Registry) FetchAccounted(
	ctx context.Context, kind string, cfgRaw []byte,
) (Accounted, error) {
	f, ok := r.fetchers[kind]
	if !ok {
		return Accounted{}, fmt.Errorf("fetch kind %q: %w",
			kind, jobsmodel.ErrJobSourceKindInvalid)
	}
	if a, isAcc := f.(Accountant); isAcc {
		acc, aerr := a.FetchAccounted(ctx, cfgRaw)
		if aerr != nil {
			return Accounted{}, fmt.Errorf("fetch %s: %w", kind, aerr)
		}
		acc.Jobs = readableJobs(acc.Jobs)
		return acc, nil
	}
	jobs, ferr := f.Fetch(ctx, cfgRaw)
	if ferr != nil {
		return Accounted{}, fmt.Errorf("fetch %s: %w", kind, ferr)
	}
	out := readableJobs(jobs)
	return Accounted{Jobs: out, Read: len(out)}, nil
}

// readableJobs —— every character each source hands back must turn into **plain
// text** before it enters the pool (F-E-7).
//
// Why here and not patched into ten adapters separately: this is their only meeting
// point. The board gives us HTML (greenhouse's is even double-escaped), and title
// gets printed straight onto `/admin/listings` while body_text goes straight into the
// owner's model — both are positions meant for a human/model to read, and markup has
// no business sitting there. Adapters still **don't parse structure** (splitting
// into Company | Title | … stays Claude's job); this step only unwinds the
// transport-layer encoding.
func readableJobs(jobs []jobsmodel.FetchedJob) []jobsmodel.FetchedJob {
	for i := range jobs {
		jobs[i].Title = strings.TrimSpace(plaintext.FromHTML(jobs[i].Title))
		jobs[i].BodyText = plaintext.FromHTML(jobs[i].BodyText)
		// company gets the same treatment (F-E-30). This line used to just TrimSpace —
		// while the lines right above and below it were decoding HTML for title and
		// body_text. The cost showed up in the worst possible place: a resume PDF sent
		// to a recruiter, header printed as `STORE MANAGER · FOR JACK &AMP; JONES`
		// (this actually rendered in prod). The real RemoteOK payload sends exactly
		// `"company":"JACK &amp; JONES"`.
		jobs[i].Company = strings.TrimSpace(plaintext.FromHTML(jobs[i].Company))
		jobs[i].Location = normalizeLocation(jobs[i].Location)
	}
	return jobs
}

// normalizeLocation —— normalizes a comma-separated location string, once (UX-88).
//
// RemoteOK itself sends exactly `"San Francisco, "`: city present, region empty, the
// separator left dangling. A faithful mapping carries it through as-is, so
// `/admin/listings` reads `remoteok · Karratha,` — the owner assumes more text got
// cut off after it. Fixed here rather than at that column's render site: location has
// several consumers (the listing, `jobs.show`, the JD summary in a resume draft), and
// patching at the display site means fixing each one separately, with the next
// consumer bound to forget again (global rule #4: **normalize foreign data once at
// the entry point, downstream treats the field as always present**).
//
// The rule is "split on the separator, drop empty segments, rejoin" — not "strip a
// trailing comma". The latter can't handle `", Australia"` and `"Berlin, , DE"`,
// which are two faces of the same problem. A genuine two-part location
// (`"Sydney, Australia"`) passes through unchanged.
func normalizeLocation(s string) string {
	parts := strings.Split(s, ",")
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			kept = append(kept, trimmed)
		}
	}
	// The tail can still carry a different bare separator (`"Remote -"`), which the
	// comma split can't catch.
	return strings.TrimRight(strings.Join(kept, ", "), " -–—;/|")
}

// ValidateKindConfig —— validates the (kind, config) shape on the register_source
// path: whether kind is in the enum + whether config JSON decodes into the per-kind
// type + required fields are non-empty.
func ValidateKindConfig(kind string, cfgRaw []byte) error {
	v, ok := configValidators[kind]
	if !ok {
		return fmt.Errorf("kind %q: %w", kind, jobsmodel.ErrJobSourceKindInvalid)
	}
	if err := v(cfgRaw); err != nil {
		return fmt.Errorf("%s config: %w", kind, err)
	}
	return nil
}

// configValidators is the kind → cfg-shape-check dispatch table. Each entry reuses
// the adapter's own typed config struct, keeping a single source of truth.
var configValidators = map[string]func([]byte) error{
	KindGreenhouse:       validateGreenhouseCfg,
	KindLever:            validateLeverCfg,
	KindAshby:            validateAshbyCfg,
	KindSmartRecruiters:  validateSmartRecruitersCfg,
	KindWorkable:         validateWorkableCfg,
	KindWWR:              validateWWRCfg,
	KindRemoteOK:         validateEmptyCfg,
	KindHNHiring:         validateEmptyCfg,
	KindJBA:              validateJBACfg,
	KindWorkday:          validateWorkdayCfg,
	KindBambooHR:         validateBambooHRCfg,
	KindJobicy:           validateEmptyCfg,
	KindRemotive:         validateEmptyCfg,
	KindHimalayas:        validateEmptyCfg,
	KindWorkingNomads:    validateEmptyCfg,
	KindRecruitee:        validateRecruiteeCfg,
	KindJobPostingJSONLD: validateJSONLDCfg,
	KindRSS:              validateRSSCfg,
}

// validateEmptyCfg —— remoteok / hn_hiring need no config at all; accepts whatever is passed.
func validateEmptyCfg(_ []byte) error { return nil }

// ErrUpstream —— the adapter got a non-2xx HTTP response (5xx included). Callers can
// errors.Is to distinguish "the source is down" from "misconfigured".
var ErrUpstream = errors.New("upstream job board error")

// The three below **wrap** ErrUpstream (`%w`), so an existing `errors.Is(err,
// ErrUpstream)` still holds, and anywhere that wants finer detail can ask one level
// deeper.
//
// **Why split them**: the line an owner reads only says "what to do next", and these
// three situations have different next actions — a move means go find the new
// address; no board at that address means go fix the typo'd slug; rate-limited means
// do nothing at all. They used to be crammed into one class, so the same "it may have
// moved" line lied about a 404, sending the owner off to find an address that doesn't
// exist (F-E-28, actually hit in prod). When one error class collapses, the sentence
// written for it can never come out ([[collapsed-error-class-kills-its-own-branch]]).
var (
	// ErrUpstreamMoved —— 3xx. The board changed address, and this client deliberately
	// doesn't follow redirects (SSRF hardening).
	ErrUpstreamMoved = fmt.Errorf("%w: the board redirected us", ErrUpstream)
	// ErrUpstreamNoBoard —— 404 / 410. There's no board at that address: most likely a
	// typo'd company slug, or this company stopped using this ATS.
	ErrUpstreamNoBoard = fmt.Errorf("%w: no board at that address", ErrUpstream)
	// ErrUpstreamBusy —— 429 / 503. The board asked us to slow down. There's nothing for
	// the owner to do; the next cycle will retry.
	ErrUpstreamBusy = fmt.Errorf("%w: the board asked us to slow down", ErrUpstream)
)

// ErrUpstreamSchema —— the source returned 2xx but the payload shape doesn't match
// (missing fields, JSON that won't decode). Usually fixture drift or the source
// changing its API fields.
var ErrUpstreamSchema = errors.New("upstream schema mismatch")

// ErrUpstreamAuth —— the upstream rejected this credential. **Must stay separate from
// ErrUpstreamSchema**: the owner's next action is completely different (swap the
// token vs. fix the adapter), and real Workable disguises an auth failure as the
// latter — a bad token gets a `302 → /oops` (HTML) reply, and following it turns into
// "2xx but won't decode" (F-E-17).
var ErrUpstreamAuth = errors.New("upstream rejected the credential")
