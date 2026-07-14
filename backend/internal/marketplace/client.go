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
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/httpx"
)

// defaults — overridable per-Client.
const (
	defaultGitHubBase = "https://api.github.com/repos/anthropics/skills"
	// SkillsMP's real API is a path on the main host, not an `api.` subdomain (that
	// subdomain doesn't resolve — the original value here was the bug that made SkillsMP
	// look dead). It indexes ~2M SKILL.md files across GitHub, each with a githubUrl + stars.
	defaultSkillsMPBase = "https://skillsmp.com/api/v1"
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
		http: httpx.NewClient(httpx.Options{Timeout: httpTimeout}),
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
	return dedupePreferEnglish(out.snapshot())
}

func includes(filter, source SourceFilter) bool {
	return filter != SourceGitHub && filter != SourceSkillsMP || filter == source
}

// asciiMax —— highest ASCII rune; runes above it (CJK etc.) count as "non-English".
const asciiMax = 127

// dedupePreferEnglish —— collapse the same skill listed more than once (SkillsMP indexes
// EN + translated variants of one skill as separate rows, and a skill can appear in both
// the official repo and SkillsMP). Keys on name+author; among duplicates keeps the
// more-English description (fewer non-ASCII runes), tie-broken by higher stars. Order kept.
func dedupePreferEnglish(skills []domain.MarketSkill) []domain.MarketSkill {
	at := make(map[string]int, len(skills))
	out := make([]domain.MarketSkill, 0, len(skills))
	for i := range skills {
		key := dedupeKey(skills[i].Name, skills[i].Author)
		if idx, seen := at[key]; seen {
			if preferable(&skills[i], &out[idx]) {
				out[idx] = skills[i]
			}
			continue
		}
		at[key] = len(out)
		out = append(out, skills[i])
	}
	return out
}

func dedupeKey(name, author string) string {
	norm := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	return norm(name) + "\x00" + norm(author)
}

// preferable —— should `cand` replace the kept `cur`? More English wins; tie → more stars.
func preferable(cand, cur *domain.MarketSkill) bool {
	ca, cb := nonASCIICount(cand.Description), nonASCIICount(cur.Description)
	if ca != cb {
		return ca < cb
	}
	return cand.Stars > cur.Stars
}

func nonASCIICount(s string) int {
	n := 0
	for _, r := range s {
		if r > asciiMax {
			n++
		}
	}
	return n
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
