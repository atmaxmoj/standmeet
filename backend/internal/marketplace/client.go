// Package marketplace —— skill-marketplace aggregation client. Searches
// the anthropics/skills GitHub repo + the SkillsMP HTTP API in parallel
// and returns the union of MarketSkill entries.
//
// Why a backend proxy: keeps GitHub's anonymous rate limit + auth out
// of the browser, lets us swap SkillsMP for a real service later
// without touching the frontend, and gives e2e a single
// `MARKETPLACE_*_BASE_URL` env knob to point at the in-cluster mock.
package marketplace

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// defaults — overridable per-Client.
const (
	defaultGitHubBase   = "https://api.github.com/repos/anthropics/skills"
	defaultSkillsMPBase = "https://api.skillsmp.com/v1"
	httpTimeout         = 8 * time.Second
	directoryCacheTTL   = 10 * time.Minute
)

// Client —— aggregate search over GitHub + SkillsMP.
type Client struct {
	http         *http.Client
	cache        *directoryCache
	githubBase   string
	skillsmpBase string
}

// NewFromEnv builds a Client from the given base URL overrides (use the
// MARKETPLACE_GITHUB_BASE_URL / MARKETPLACE_SKILLSMP_BASE_URL env vars at
// the wireup layer). Empty string → built-in real-upstream default.
func NewFromEnv(githubBase, skillsmpBase string) *Client {
	return &Client{
		http: &http.Client{Timeout: httpTimeout},
		cache: &directoryCache{
			entries: map[string]cacheEntry{},
		},
		githubBase:   firstNonEmpty(githubBase, defaultGitHubBase),
		skillsmpBase: firstNonEmpty(skillsmpBase, defaultSkillsMPBase),
	}
}

// SourceFilter —— "all" | "github" | "skillsmp". Unknown values reduce
// to "all" (defensive — frontend may send anything).
type SourceFilter string

// SourceFilter enumerated values.
const (
	// SourceAll —— search every marketplace source in parallel.
	SourceAll SourceFilter = "all"
	// SourceGitHub —— GitHub repo only (skips SkillsMP fetch).
	SourceGitHub SourceFilter = "github"
	// SourceSkillsMP —— SkillsMP only (skips GitHub fetch).
	SourceSkillsMP SourceFilter = "skillsmp"
)

// Search —— concurrent fetch of GitHub + SkillsMP; either source failing
// returns a (possibly partial) result rather than erroring out, so the
// owner always sees something. `source` accepts "all" | "github" |
// "skillsmp"; any other value reduces to "all" (defensive).
func (c *Client) Search(
	ctx context.Context, query, source string,
) []domain.MarketSkill {
	filter := SourceFilter(source)
	out := newResultCollector()
	var wg sync.WaitGroup
	if includes(filter, SourceGitHub) {
		wg.Go(func() { out.append(c.searchGitHub(ctx, query)) })
	}
	if includes(filter, SourceSkillsMP) {
		wg.Go(func() { out.append(c.searchSkillsMP(ctx, query)) })
	}
	wg.Wait()
	return out.snapshot()
}

func includes(filter, source SourceFilter) bool {
	return filter != SourceGitHub && filter != SourceSkillsMP || filter == source
}

// resultCollector —— thread-safe append-only slice.
type resultCollector struct {
	items []domain.MarketSkill
	mu    sync.Mutex
}

func newResultCollector() *resultCollector {
	return &resultCollector{items: []domain.MarketSkill{}}
}

func (r *resultCollector) append(batch []domain.MarketSkill) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items = append(r.items, batch...)
}

func (r *resultCollector) snapshot() []domain.MarketSkill {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.MarketSkill, len(r.items))
	copy(out, r.items)
	return out
}

// ErrSourceUnreachable —— wrapped by Search internals when a source
// can't be reached; caller doesn't surface it to the user (partial result
// pattern), but it's a useful sentinel for tests.
var ErrSourceUnreachable = errors.New("marketplace source unreachable")

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
