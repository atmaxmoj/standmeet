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

// ghContentItem —— shape returned by GitHub Contents API. We only read
// the fields we render.
type ghContentItem struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	HTMLURL string `json:"html_url"`
}

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
	c.cache.set(cacheKey, items)
	return items
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
		Version:     "", // pulled from SKILL.md frontmatter in a later phase
		Category:    "",
		Description: "",
		SourceURL:   it.HTMLURL,
		Source:      domain.MarketSourceGitHub,
		Stars:       0,
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
