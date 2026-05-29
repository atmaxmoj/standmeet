// skillsmp.go —— SkillsMP HTTP API client. The hostname is real on
// production (`api.skillsmp.com`); in dev/e2e the base URL points at
// our mock so we don't depend on an upstream that may not exist yet.

package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

// smpSearchResponse —— shape exposed by SkillsMP `/skills/search`.
type smpSearchResponse struct {
	Skills []smpSkill `json:"skills"`
}

type smpSkill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Version     string `json:"version"`
	URL         string `json:"url"`
	Stars       int    `json:"stars"`
}

func (c *Client) searchSkillsMP(ctx context.Context, query string) []domain.MarketSkill {
	resp, err := getSkillsMP(ctx, c.http, c.skillsmpBase, query)
	if err != nil {
		// Partial-result pattern — let GitHub's results carry the page.
		return nil
	}
	out := make([]domain.MarketSkill, 0, len(resp.Skills))
	for i := range resp.Skills {
		s := resp.Skills[i]
		out = append(out, smpToMarketSkill(&s))
	}
	return out
}

func getSkillsMP(
	ctx context.Context, hc *http.Client, base, query string,
) (smpSearchResponse, error) {
	req, rerr := buildSkillsMPRequest(ctx, base, query)
	if rerr != nil {
		return smpSearchResponse{}, rerr
	}
	httpResp, err := hc.Do(req)
	if err != nil {
		return smpSearchResponse{}, fmt.Errorf("skillsmp get: %w", err)
	}
	defer closeBody(httpResp.Body)
	return decodeSkillsMP(httpResp)
}

func buildSkillsMPRequest(
	ctx context.Context, base, query string,
) (*http.Request, error) {
	u := strings.TrimRight(base, "/") + "/skills/search"
	if query != "" {
		u = u + "?q=" + url.QueryEscape(query)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	return req, nil
}

func decodeSkillsMP(resp *http.Response) (smpSearchResponse, error) {
	if resp.StatusCode != http.StatusOK {
		return smpSearchResponse{}, fmt.Errorf("skillsmp status %d", resp.StatusCode)
	}
	var decoded smpSearchResponse
	if derr := json.NewDecoder(resp.Body).Decode(&decoded); derr != nil {
		return smpSearchResponse{}, fmt.Errorf("skillsmp decode: %w", derr)
	}
	return decoded, nil
}

func smpToMarketSkill(s *smpSkill) domain.MarketSkill {
	return domain.MarketSkill{
		ID:          s.ID,
		Name:        s.Name,
		Author:      s.Author,
		Version:     s.Version,
		Category:    s.Category,
		Description: s.Description,
		SourceURL:   s.URL,
		Source:      domain.MarketSourceSkillsMP,
		Stars:       s.Stars,
	}
}
