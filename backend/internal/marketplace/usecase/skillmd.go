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

package usecase

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
)

// FetchSkillContent fetches + parses a market skill's SKILL.md. `sourceURL` is the skill's
// githubUrl (used by the SkillsMP path, which has no content endpoint); the GitHub source
// ignores it and derives the path from `id`.
func (c *Client) FetchSkillContent(
	ctx context.Context, source entity.MarketSource, id, sourceURL string,
) (entity.MarketSkillContent, error) {
	raw, err := c.fetchSkillMD(ctx, source, id, sourceURL)
	if err != nil {
		return entity.MarketSkillContent{}, err
	}
	return parseSkillMD(raw), nil
}

// ParseSkillMD —— for manual install (owner pastes a SKILL.md they found/downloaded
// anywhere): same parser the marketplace fetch path uses, no network. A Client method so
// the usecase layer reaches it through the MarketplaceClient interface (no direct import).
func (*Client) ParseSkillMD(raw string) entity.MarketSkillContent {
	return parseSkillMD(raw)
}

func (c *Client) fetchSkillMD(
	ctx context.Context, source entity.MarketSource, id, sourceURL string,
) (string, error) {
	switch source {
	case entity.MarketSourceGitHub:
		return c.fetchGitHubSkillMD(ctx, id)
	case entity.MarketSourceSkillsMP:
		return c.fetchSkillMDFromTreeURL(ctx, sourceURL)
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

// fetchSkillMDFromTreeURL —— SkillsMP has no content endpoint; each skill carries a github
// tree URL (github.com/OWNER/REPO/tree/BRANCH/PATH). Convert it to the raw SKILL.md URL and
// fetch the plain text.
func (c *Client) fetchSkillMDFromTreeURL(ctx context.Context, treeURL string) (string, error) {
	raw := rawSkillMDURL(treeURL)
	if raw == "" {
		return "", fmt.Errorf("unrecognized github url %q", treeURL)
	}
	resp, err := c.getURL(ctx, raw, "text/plain")
	if err != nil {
		return "", err
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("raw SKILL.md status %d", resp.StatusCode)
	}
	body, rerr := io.ReadAll(resp.Body)
	if rerr != nil {
		return "", fmt.Errorf("read raw SKILL.md: %w", rerr)
	}
	return string(body), nil
}

// rawSkillMDURL —— github.com/O/R/tree/B/PATH → raw.githubusercontent.com/O/R/B/PATH/SKILL.md.
// Returns "" if the URL isn't a github tree URL.
func rawSkillMDURL(treeURL string) string {
	if !strings.Contains(treeURL, "github.com/") || !strings.Contains(treeURL, "/tree/") {
		return ""
	}
	raw := strings.Replace(treeURL, "github.com/", "raw.githubusercontent.com/", 1)
	raw = strings.Replace(raw, "/tree/", "/", 1)
	return strings.TrimRight(raw, "/") + "/SKILL.md"
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

func parseSkillMD(raw string) entity.MarketSkillContent {
	r := splitFrontmatter(raw)
	return entity.MarketSkillContent{
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
		end += 1 + fm.absorbBlock(lines, end, curKey)
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

// absorbBlock —— if the record just consumed held a YAML block-scalar MARKER (`|`, `>`, and
// their chomp variants) instead of a value, pull in the indented block that follows and replace
// the marker with it. Returns how many extra lines were eaten.
//
// Without this the block is lost twice over: `consume` stores the marker as the value, and every
// line of the block has no colon, so `splitKV` returns an empty key and drops it. The marketplace
// card for `Claude Api` therefore read as the two characters `|-` (F-F-1) — the surface rendering
// its source instead of its content, and silently, for every skill whose author writes this way.
func (fm *frontmatter) absorbBlock(lines []string, i int, key string) int {
	sep, ok := blockJoiner(fm.scalars[key])
	if !ok {
		return 0
	}
	block, n := readIndented(lines, i+1)
	fm.scalars[key] = joinBlock(block, sep)
	return n
}

// blockJoiner —— what glues the block's lines back together: `|` keeps the line breaks, `>`
// folds them into spaces. A trailing `-`/`+` is the chomp indicator. ok=false means this is an
// ordinary inline value and there is no block to read.
func blockJoiner(val string) (string, bool) {
	marker := strings.TrimRight(strings.TrimSpace(val), "-+")
	joiner := map[string]string{"|": "\n", ">": " "}
	sep, ok := joiner[marker]
	return sep, ok
}

// readIndented —— the block is every following line that is indented (or blank). The closing
// `---` and the next key sit at column 0, so they end it.
func readIndented(lines []string, from int) ([]string, int) {
	out, n := []string{}, 0
	for from+n < len(lines) && isBlockLine(lines[from+n]) {
		out = append(out, strings.TrimSpace(lines[from+n]))
		n++
	}
	return out, n
}

func isBlockLine(line string) bool {
	return strings.TrimSpace(line) == "" ||
		strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t")
}

func joinBlock(block []string, sep string) string {
	return strings.TrimSpace(strings.Join(block, sep))
}

func (fm *frontmatter) addToolIf(curKey, item string) {
	if curKey == "allowed-tools" && item != "" {
		fm.tools = append(fm.tools, strings.Trim(item, `"'`))
	}
}

type kv struct{ key, val string }

// splitKV —— `key: value` → kv. No colon returns an empty key (caller skips it).
func splitKV(line string) kv {
	idx := strings.Index(line, ":")
	if idx <= 0 {
		return kv{}
	}
	return kv{key: strings.TrimSpace(line[:idx]), val: strings.TrimSpace(line[idx+1:])}
}

const inlineListCap = 4

// parseInlineList —— `[a, b]` or `a, b` → ["a","b"]. Empty, or a block-list starter,
// returns an empty slice.
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
