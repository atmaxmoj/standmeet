// skillsmp.go —— SkillsMP search source (skillsmp.com/api/v1). SkillsMP indexes ~2M
// SKILL.md files crawled from GitHub; each result carries a githubUrl + star count, which
// is what install fetches the SKILL.md from (SkillsMP has no per-skill content endpoint).

package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

// smpSearchResponse —— skillsmp.com/api/v1/skills/search shape: {success, data:{skills:[…]}}.
type smpSearchResponse struct {
	Data    smpData `json:"data"`
	Success bool    `json:"success"`
}

type smpData struct {
	Skills []smpSkill `json:"skills"`
}

type smpSkill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Author      string `json:"author"`
	Description string `json:"description"`
	GithubURL   string `json:"githubUrl"`
	Stars       int    `json:"stars"`
}

func (c *Client) searchSkillsMP(ctx context.Context, query string) []entity.MarketSkill {
	resp, err := getSkillsMP(ctx, c.http, c.skillsmpBase, query)
	if err != nil {
		// Partial-result pattern — let GitHub's results carry the page.
		return []entity.MarketSkill{}
	}
	out := make([]entity.MarketSkill, 0, len(resp.Data.Skills))
	for i := range resp.Data.Skills {
		out = append(out, smpToMarketSkill(&resp.Data.Skills[i]))
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

// skillsmpPageSize —— skills to pull per query. SkillsMP defaults to 20; we ask for the top
// 100 by stars so the marketplace has a real, load-more-able pool of the most popular skills
// (owners want the hottest, not all ~2M). Deep pagination past 100 is a later refinement.
const skillsmpPageSize = 100

func buildSkillsMPRequest(
	ctx context.Context, base, query string,
) (*http.Request, error) {
	q := query
	if strings.TrimSpace(q) == "" {
		q = "skill" // SkillsMP requires a query; a broad term seeds the default listing.
	}
	u := fmt.Sprintf("%s/skills/search?q=%s&limit=%d",
		strings.TrimRight(base, "/"), url.QueryEscape(q), skillsmpPageSize)
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

func smpToMarketSkill(s *smpSkill) entity.MarketSkill {
	return entity.MarketSkill{
		ID:          s.ID,
		Name:        s.Name,
		Author:      s.Author,
		Category:    "",
		Description: s.Description,
		SourceURL:   s.GithubURL, // where install fetches the SKILL.md from
		Source:      entity.MarketSourceSkillsMP,
		Stars:       s.Stars,
	}
}
