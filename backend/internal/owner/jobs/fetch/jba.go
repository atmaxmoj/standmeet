// jba.go —— JobBoardAggregator (Feashliaa) adapter.
//
// JBA is a community-maintained OSS scraper: every day it uses GitHub Actions to scrape
// public endpoints of real ATSes — Greenhouse / Lever / Ashby / Workday / BambooHR —
// aggregating ~1.5M jobs, sliced into 58 .json.gz chunks of 25k jobs each, statically
// hosted on GitHub Pages:
//
//	manifest: {base}/data/chunks/jobs_manifest.json
//	  → {"chunks": ["jobs_chunk_0.json.gz", ...], "totalJobs": N, "last_updated": "..."}
//	chunk:    {base}/data/chunks/{name}.json.gz
//	  → [{company, title, location, url, ats, skill_level, scraped_at, ...}, ...]
//
// This is cheaper than maintaining 8 ATS adapters ourselves: JBA already handles
// scraping + reposting + dead-link cleanup, so we just pull it locally and filter by
// the owner's criteria. The cost is data latency of ≤ 1 day, and the license is
// CC BY-NC (fine for the owner's own use; a future product use needs a different
// source / a self-maintained backend).
//
// Config shape (per-source register_source input):
//
//	{ "title_keywords": ["..."], "location": "...",
//	  "ats": "...", "max_chunks": N }
//
// All optional. An empty filter means no filtering; max_chunks defaults to 5
// (≈125k jobs) as a safety net, so a single fetch_new can't drag down the whole
// 1.5M set — an owner who wants everything sets max_chunks=58 explicitly.

package fetch

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

const (
	// jbaDefaultBase —— the production GitHub Pages domain; e2e overrides it via env to
	// the external-mock container docker-compose starts, which serves fixture chunks.
	jbaDefaultBase = "https://feashliaa.github.io/job-board-aggregator"
	// jbaManifestPath / jbaChunkDir —— fixed relative paths on GitHub Pages.
	jbaManifestPath = "/data/chunks/jobs_manifest.json"
	jbaChunkDir     = "/data/chunks/"
	// jbaDefaultMaxChunks —— how many chunks to pull when max_chunks isn't set (25k jobs
	// each, so ~125k total is already enough for most filters; an owner who wants the
	// full set sets max_chunks=58 explicitly).
	jbaDefaultMaxChunks = 5
	// jbaMaxChunksCap —— hard ceiling as a safety net; the manifest currently has 58
	// chunks, so this leaves some headroom.
	jbaMaxChunksCap = 128
)

// jbaFetcher —— Fetcher implementation. client / base reuse the shared pool inside the
// fetch package.
type jbaFetcher struct {
	client *http.Client
	base   string
}

func newJBAFetcher(client *http.Client, envBase string) *jbaFetcher {
	return &jbaFetcher{
		client: client,
		base:   firstOrDefault(envBase, jbaDefaultBase),
	}
}

// jbaConfig —— the JSON config shape passed up by register_source.
// Field order follows govet fieldalignment: strings first (ptr+len 16 bytes each),
// slice in the middle (ptr leads the header), int last.
type jbaConfig struct {
	Location      string   `json:"location"`
	ATS           string   `json:"ats"`
	TitleKeywords []string `json:"title_keywords"`
	MaxChunks     int      `json:"max_chunks"`
}

// jbaManifest —— the manifest shape on GitHub Pages (jba generates it itself).
// Field order follows govet fieldalignment: string first, slice next, int last.
type jbaManifest struct {
	LastUpdated string   `json:"last_updated"`
	Chunks      []string `json:"chunks"`
	TotalJobs   int      `json:"totalJobs"`
}

// jbaEntry —— a single job decoded out of the gzip. salary / is_recruiter fields are
// ignored (the FetchedJob shape doesn't carry them; extend later when a J-phase
// scoring feature needs them).
type jbaEntry struct {
	Company    string `json:"company"`
	Title      string `json:"title"`
	SkillLevel string `json:"skill_level"`
	Location   string `json:"location"`
	URL        string `json:"url"`
	ATS        string `json:"ats"`
	ScrapedAt  string `json:"scraped_at"`
}

// Fetch —— single-source entry point.
func (f *jbaFetcher) Fetch(
	ctx context.Context, cfgRaw []byte,
) ([]jobsmodel.FetchedJob, error) {
	cfg, err := decodeJBAConfig(cfgRaw)
	if err != nil {
		return nil, err
	}
	manifest, err := f.fetchManifest(ctx)
	if err != nil {
		return nil, err
	}
	return f.fetchChunks(ctx, manifest, cfg)
}

func (f *jbaFetcher) fetchManifest(ctx context.Context) (*jbaManifest, error) {
	url := f.base + jbaManifestPath
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	var m jbaManifest
	if uerr := json.Unmarshal(body, &m); uerr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, uerr)
	}
	if len(m.Chunks) == 0 {
		return nil, fmt.Errorf("%s: %w: empty chunks", url, ErrUpstreamSchema)
	}
	return &m, nil
}

func (f *jbaFetcher) fetchChunks(
	ctx context.Context, m *jbaManifest, cfg *jbaConfig,
) ([]jobsmodel.FetchedJob, error) {
	limit := pickJBAChunkLimit(cfg.MaxChunks, len(m.Chunks))
	matcher := newJBAMatcher(cfg)
	out := make([]jobsmodel.FetchedJob, 0, jbaInitialOutCap(limit))
	for i := range limit {
		appended, err := f.appendMatchingFromChunk(ctx, m.Chunks[i], matcher, out)
		if err != nil {
			return nil, err
		}
		out = appended
	}
	return out, nil
}

func (f *jbaFetcher) appendMatchingFromChunk(
	ctx context.Context, name string, matcher *jbaMatcher, out []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	entries, err := f.fetchOneChunk(ctx, name)
	if err != nil {
		return nil, err
	}
	for j := range entries {
		if matcher.match(&entries[j]) {
			out = append(out, jbaEntryToDomain(&entries[j]))
		}
	}
	return out, nil
}

func (f *jbaFetcher) fetchOneChunk(
	ctx context.Context, name string,
) ([]jbaEntry, error) {
	url := f.base + jbaChunkDir + name
	body, err := getBody(ctx, f.client, url)
	if err != nil {
		return nil, err
	}
	entries, derr := decodeGzippedJSONArray(body)
	if derr != nil {
		return nil, fmt.Errorf("decode %s: %w: %w", url, ErrUpstreamSchema, derr)
	}
	return entries, nil
}

// decodeJBAConfig —— accepts an empty cfgRaw / empty JSON object; a zero-valued
// jbaConfig means "no filtering".
func decodeJBAConfig(raw []byte) (*jbaConfig, error) {
	cfg := &jbaConfig{}
	if len(bytes.TrimSpace(raw)) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(raw, cfg); err != nil {
		return nil, fmt.Errorf("decode jba config: %w", err)
	}
	return cfg, nil
}

func pickJBAChunkLimit(req, available int) int {
	if req <= 0 {
		req = jbaDefaultMaxChunks
	}
	if req > jbaMaxChunksCap {
		req = jbaMaxChunksCap
	}
	if req > available {
		req = available
	}
	return req
}

// jbaInitialOutCap —— estimates the out cap assuming a ~1% match rate; overshooting
// is harmless, and undershooting just lets append grow naturally.
func jbaInitialOutCap(chunkLimit int) int {
	const approxJobsPerChunk = 25000
	const approxMatchRatePer100 = 1
	return chunkLimit * approxJobsPerChunk * approxMatchRatePer100 / 100
}

// maxGunzipBytes —— hard cap on a JBA chunk's DECOMPRESSED size (gzip-bomb guard). Generous vs a
// legit ~25k-job chunk (~12 MiB uncompressed).
const maxGunzipBytes = 64 << 20 // 64 MiB

// decodeGzippedJSONArray —— body is gzipped JSON []jbaEntry. Streaming gunzip avoids
// inflating everything into memory at once; Decoder.Token verifies it starts with `[`.
func decodeGzippedJSONArray(body []byte) ([]jbaEntry, error) {
	gr, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer closeQuiet(gr)
	// bound the DECOMPRESSED size so a gzip bomb (tiny compressed → huge inflated) can't OOM us.
	// generous vs a legit ~25k-job chunk (~12 MiB uncompressed); read one past to detect overflow.
	raw, err := io.ReadAll(io.LimitReader(gr, maxGunzipBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read gunzip: %w", err)
	}
	if int64(len(raw)) > maxGunzipBytes {
		return nil, fmt.Errorf("%w: gunzip output exceeds %d bytes", ErrUpstream, maxGunzipBytes)
	}
	var entries []jbaEntry
	if uerr := json.Unmarshal(raw, &entries); uerr != nil {
		return nil, fmt.Errorf("unmarshal entries: %w", uerr)
	}
	return entries, nil
}

// jbaMatcher —— register_source config → whether a single entry is kept. All fields
// are optional; empty means pass-through.
// Field order: strings first (ptr leads), slice right after.
type jbaMatcher struct {
	location      string
	ats           string
	titleKeywords []string
}

func newJBAMatcher(cfg *jbaConfig) *jbaMatcher {
	m := &jbaMatcher{
		location: strings.ToLower(strings.TrimSpace(cfg.Location)),
		ats:      strings.ToLower(strings.TrimSpace(cfg.ATS)),
	}
	for _, k := range cfg.TitleKeywords {
		if v := strings.ToLower(strings.TrimSpace(k)); v != "" {
			m.titleKeywords = append(m.titleKeywords, v)
		}
	}
	return m
}

func (m *jbaMatcher) match(e *jbaEntry) bool {
	if m.ats != "" && !strings.EqualFold(e.ATS, m.ats) {
		return false
	}
	if m.location != "" &&
		!strings.Contains(strings.ToLower(e.Location), m.location) {
		return false
	}
	return m.titleMatches(e.Title)
}

func (m *jbaMatcher) titleMatches(title string) bool {
	if len(m.titleKeywords) == 0 {
		return true
	}
	lower := strings.ToLower(title)
	for _, kw := range m.titleKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

func jbaEntryToDomain(e *jbaEntry) jobsmodel.FetchedJob {
	var published time.Time
	if t, perr := time.Parse(time.RFC3339Nano, e.ScrapedAt); perr == nil {
		published = t
	}
	tags := make([]string, 0, defaultTagCap)
	tags = appendIfNonEmpty(tags, e.ATS)
	tags = appendIfNonEmpty(tags, e.SkillLevel)
	return jobsmodel.FetchedJob{
		ExternalID:  e.URL,
		Title:       strings.TrimSpace(e.Title),
		Company:     strings.TrimSpace(e.Company),
		Location:    strings.TrimSpace(e.Location),
		URL:         e.URL,
		Tags:        tags,
		PublishedAt: published,
		SourceKind:  KindJBA,
	}
}

// validateJBACfg —— called on the register_source path. All fields are optional;
// an empty cfg / empty JSON object is fine; only surfaces deserialize failures and
// a negative max_chunks.
func validateJBACfg(raw []byte) error {
	cfg, err := decodeJBAConfig(raw)
	if err != nil {
		return err
	}
	if cfg.MaxChunks < 0 {
		return fmt.Errorf("max_chunks must be >= 0 (got %d)", cfg.MaxChunks)
	}
	return nil
}
