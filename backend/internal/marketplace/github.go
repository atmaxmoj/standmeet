// github.go —— GitHub Contents API fetch for anthropics/skills.
//
// The repo's top-level `/skills/` directory is the source of truth for
// installable skills. Each subdir there has a `SKILL.md` whose
// frontmatter holds name / description / version / category. v1 stops
// at the directory listing — we surface the skill folder as a card,
// fill in the metadata when the frontmatter parser lands.

package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// ghContentItem —— shape returned by GitHub Contents API. Name/Type/HTMLURL come
// from the listing; Description/Version are enriched from each dir's SKILL.md
// (not on the Contents API) so cards aren't blank (UX-13).
type ghContentItem struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	HTMLURL     string `json:"html_url"`
	Description string `json:"-"`
	Version     string `json:"-"`
}

// githubEnrichConcurrency —— cap on parallel SKILL.md fetches when filling the
// directory cache, so a large repo doesn't fan out an unbounded burst at GitHub.
const githubEnrichConcurrency = 8

func (c *Client) searchGitHub(ctx context.Context, query string) []domain.MarketSkill {
	items := c.fetchGitHubDirectory(ctx)
	out := make([]domain.MarketSkill, 0, len(items))
	for i := range items {
		it := items[i]
		if it.Type != "dir" {
			continue
		}
		if !nameMatches(it.Name, query) {
			continue
		}
		out = append(out, ghContentToMarketSkill(&it))
	}
	return out
}

func (c *Client) fetchGitHubDirectory(ctx context.Context) []ghContentItem {
	cacheKey := "github:directory"
	if cached, ok := c.cache.get(cacheKey); ok {
		return cached
	}
	url := c.githubBase + "/contents/skills"
	items, err := getGHContents(ctx, c.http, url)
	if err != nil {
		// Partial-result pattern — return empty so the union still
		// surfaces SkillsMP results if any.
		return []ghContentItem{}
	}
	c.enrichGitHubMetadata(ctx, items)
	c.cache.set(cacheKey, items)
	return items
}

// enrichGitHubMetadata —— fill each skill dir's Description/Version from its SKILL.md
// so the marketplace cards aren't blank (UX-13). Concurrent (bounded) and tolerant: a
// skill whose SKILL.md 404s / fails to parse just keeps empty metadata. Done once per
// directory-cache fill (not per search), then cached with the listing.
func (c *Client) enrichGitHubMetadata(ctx context.Context, items []ghContentItem) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, githubEnrichConcurrency)
	for i := range items {
		if items[i].Type != "dir" {
			continue
		}
		sem <- struct{}{}
		it := &items[i]
		wg.Go(func() {
			defer func() { <-sem }()
			c.enrichOne(ctx, it)
		})
	}
	wg.Wait()
}

// enrichOne —— best-effort SKILL.md fetch+parse for one skill dir; on any error the
// item keeps its empty Description/Version (the card just shows less, never fails).
func (c *Client) enrichOne(ctx context.Context, it *ghContentItem) {
	content, err := c.FetchSkillContent(ctx, domain.MarketSourceGitHub, it.Name, "")
	if err != nil {
		return
	}
	it.Description = content.Description
	it.Version = content.Version
}

func getGHContents(
	ctx context.Context, hc *http.Client, url string,
) ([]ghContentItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("github get: %w", err)
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github status %d", resp.StatusCode)
	}
	return decodeGHContents(resp.Body)
}

func closeBody(c io.Closer) {
	// Upstream HTTP body close after a completed read can't be acted on
	// (connection pool reclaims regardless). Routing the result through
	// a discard sink keeps errcheck happy without an explicit nolint.
	discardClose(c.Close())
}

// discardClose —— intentional no-op consumer for the closeBody result.
// Kept as a separate function so a future telemetry / log shim has one
// place to land.
func discardClose(_ error) {}

func decodeGHContents(r io.Reader) ([]ghContentItem, error) {
	var out []ghContentItem
	if derr := json.NewDecoder(r).Decode(&out); derr != nil {
		return nil, fmt.Errorf("github decode: %w", derr)
	}
	return out, nil
}

func ghContentToMarketSkill(it *ghContentItem) domain.MarketSkill {
	return domain.MarketSkill{
		ID:          it.Name,
		Name:        deriveDisplayName(it.Name),
		Author:      "anthropics",
		Version:     it.Version, // from the skill's SKILL.md frontmatter (enrichment)
		Category:    "",
		Description: it.Description, // ditto — so the card isn't blank (UX-13)
		SourceURL:   it.HTMLURL,
		Source:      domain.MarketSourceGitHub,
		// GitHub skills are folders in one repo → no per-skill star count.
		Stars: 0,
	}
}

// deriveDisplayName —— "tz-booking" → "Tz Booking". Imperfect but
// consistent. SKILL.md frontmatter overrides this once we parse it.
func deriveDisplayName(slug string) string {
	parts := strings.Split(slug, "-")
	for i, p := range parts {
		if p == "" {
			continue
		}
		parts[i] = strings.ToUpper(p[:1]) + p[1:]
	}
	return strings.Join(parts, " ")
}

func nameMatches(name, query string) bool {
	if query == "" {
		return true
	}
	return strings.Contains(strings.ToLower(name), strings.ToLower(query))
}

// directoryCache —— in-memory TTL'd cache for the contents listing.
// Trades correctness staleness for not hammering GitHub's anon API.
type directoryCache struct {
	entries map[string]cacheEntry
	mu      sync.Mutex
}

type cacheEntry struct {
	expiresAt time.Time
	items     []ghContentItem
}

func (c *directoryCache) get(key string) ([]ghContentItem, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok || time.Now().After(e.expiresAt) {
		return []ghContentItem{}, false
	}
	return e.items, true
}

func (c *directoryCache) set(key string, items []ghContentItem) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = cacheEntry{
		items:     items,
		expiresAt: time.Now().Add(directoryCacheTTL),
	}
}
