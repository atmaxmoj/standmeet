// skillmd.go —— SKILL.md fetch + frontmatter parse for marketplace install (#48-3).
//
// FetchSkillContent pulls a market skill's SKILL.md and parses it into
// install-ready fields. GitHub uses the Contents API (base64-encoded file body);
// SkillsMP a per-skill detail endpoint ({skill_md}). Both reuse the same
// injectable base URLs search uses, so e2e points them at the in-cluster mock.
//
// The frontmatter parser is a minimal line scanner (no yaml dependency): the
// SKILL.md format is `--- key: value … ---` then a markdown body; the body is
// the skill prompt, name/description/allowed-tools come from the frontmatter.

package marketplace

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// FetchSkillContent fetches + parses a market skill's SKILL.md.
func (c *Client) FetchSkillContent(
	ctx context.Context, source domain.MarketSource, id string,
) (domain.MarketSkillContent, error) {
	raw, err := c.fetchSkillMD(ctx, source, id)
	if err != nil {
		return domain.MarketSkillContent{}, err
	}
	return parseSkillMD(raw), nil
}

func (c *Client) fetchSkillMD(
	ctx context.Context, source domain.MarketSource, id string,
) (string, error) {
	switch source {
	case domain.MarketSourceGitHub:
		return c.fetchGitHubSkillMD(ctx, id)
	case domain.MarketSourceSkillsMP:
		return c.fetchSkillsMPSkillMD(ctx, id)
	default:
		return "", fmt.Errorf("unknown market source %q", source)
	}
}

func (c *Client) fetchGitHubSkillMD(ctx context.Context, id string) (string, error) {
	u := c.githubBase + "/contents/skills/" + url.PathEscape(id) + "/SKILL.md"
	resp, err := c.getURL(ctx, u, "application/vnd.github.v3+json")
	if err != nil {
		return "", err
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github SKILL.md status %d", resp.StatusCode)
	}
	return decodeGHFileContent(resp.Body)
}

func (c *Client) fetchSkillsMPSkillMD(ctx context.Context, id string) (string, error) {
	u := strings.TrimRight(c.skillsmpBase, "/") + "/skills/" + url.PathEscape(id)
	resp, err := c.getURL(ctx, u, "application/json")
	if err != nil {
		return "", err
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("skillsmp SKILL.md status %d", resp.StatusCode)
	}
	var d struct {
		SkillMD string `json:"skill_md"`
	}
	if jerr := json.NewDecoder(resp.Body).Decode(&d); jerr != nil {
		return "", fmt.Errorf("skillsmp detail decode: %w", jerr)
	}
	return d.SkillMD, nil
}

func (c *Client) getURL(ctx context.Context, u, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Accept", accept)
	resp, derr := c.http.Do(req)
	if derr != nil {
		return nil, fmt.Errorf("get %s: %w", u, derr)
	}
	return resp, nil
}

type ghFileContent struct {
	Content  string `json:"content"`
	Encoding string `json:"encoding"`
}

func decodeGHFileContent(r io.Reader) (string, error) {
	var f ghFileContent
	if err := json.NewDecoder(r).Decode(&f); err != nil {
		return "", fmt.Errorf("github file decode: %w", err)
	}
	if f.Encoding != "base64" {
		return f.Content, nil
	}
	dec, derr := base64.StdEncoding.DecodeString(strings.ReplaceAll(f.Content, "\n", ""))
	if derr != nil {
		return "", fmt.Errorf("github base64 decode: %w", derr)
	}
	return string(dec), nil
}

// ─── SKILL.md frontmatter parser ──────────────────────────────

func parseSkillMD(raw string) domain.MarketSkillContent {
	r := splitFrontmatter(raw)
	return domain.MarketSkillContent{
		Name:         r.fm.scalars["name"],
		Description:  r.fm.scalars["description"],
		Version:      r.fm.scalars["version"],
		Prompt:       strings.TrimSpace(r.body),
		AllowedTools: r.fm.tools,
	}
}

type frontmatter struct {
	scalars map[string]string
	tools   []string
}

type fmResult struct {
	body string
	fm   frontmatter
}

// splitFrontmatter pulls the leading `--- … ---` YAML block (if any) and returns
// the parsed scalars + allowed-tools list and the remaining body.
func splitFrontmatter(raw string) fmResult {
	fm := frontmatter{scalars: map[string]string{}, tools: []string{}}
	lines := strings.Split(raw, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return fmResult{fm: fm, body: raw}
	}
	end := 1
	curKey := ""
	for end < len(lines) {
		if strings.TrimSpace(lines[end]) == "---" {
			end++
			break
		}
		curKey = fm.consume(lines[end], curKey)
		end++
	}
	return fmResult{fm: fm, body: strings.Join(lines[end:], "\n")}
}

// consume parses one frontmatter line into fm; returns the current key so a
// following `- item` continuation line can be attributed (block-list YAML).
func (fm *frontmatter) consume(line, curKey string) string {
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "- ") {
		fm.addToolIf(curKey, strings.TrimSpace(trimmed[2:]))
		return curKey
	}
	p := splitKV(trimmed)
	if p.key == "" {
		return curKey
	}
	if p.key == "allowed-tools" {
		fm.tools = append(fm.tools, parseInlineList(p.val)...)
	} else {
		fm.scalars[p.key] = strings.Trim(p.val, `"'`)
	}
	return p.key
}

func (fm *frontmatter) addToolIf(curKey, item string) {
	if curKey == "allowed-tools" && item != "" {
		fm.tools = append(fm.tools, strings.Trim(item, `"'`))
	}
}

type kv struct{ key, val string }

// splitKV —— `key: value` → kv。无冒号返空 key(caller 跳过)。
func splitKV(line string) kv {
	idx := strings.Index(line, ":")
	if idx <= 0 {
		return kv{}
	}
	return kv{key: strings.TrimSpace(line[:idx]), val: strings.TrimSpace(line[idx+1:])}
}

const inlineListCap = 4

// parseInlineList —— `[a, b]` 或 `a, b` → ["a","b"]. 空 / block-list 起头返空切片。
func parseInlineList(val string) []string {
	out := make([]string, 0, inlineListCap)
	v := strings.TrimSpace(strings.Trim(strings.TrimSpace(val), "[]"))
	if v == "" {
		return out
	}
	for part := range strings.SplitSeq(v, ",") {
		if item := strings.Trim(strings.TrimSpace(part), `"'`); item != "" {
			out = append(out, item)
		}
	}
	return out
}
