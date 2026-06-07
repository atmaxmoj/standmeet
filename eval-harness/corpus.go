package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
	"gopkg.in/yaml.v3"
)

// corpusEntry —— one piece of the owner's curated corpus, loaded from a
// markdown file with a YAML frontmatter block. Mirrors what the owner would
// have pushed via MCP (raw_dump / promote_to_wiki).
type corpusEntry struct {
	URI   string   `yaml:"uri"`
	Title string   `yaml:"title"`
	Kind  string   `yaml:"kind"`
	Tags  []string `yaml:"tags"`
	Body  string   `yaml:"-"`
}

// corpus —— the loaded persona corpus + a uri index. Backs the corpus_search
// / corpus_read tools with *real* keyword retrieval over fixture material, so
// the agent works from genuine content (not canned results) when we audit how
// it answers an interview from "the owner's" real corpus.
type corpus struct {
	entries []corpusEntry
	byURI   map[string]*corpusEntry
}

// loadCorpus reads every .md under dir, parsing frontmatter + body.
func loadCorpus(dir string) (*corpus, error) {
	c := &corpus{byURI: map[string]*corpusEntry{}}
	walk := func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if d.IsDir() || filepath.Ext(p) != ".md" {
			return nil
		}
		e, perr := parseCorpusEntry(p)
		if perr != nil {
			return perr
		}
		c.entries = append(c.entries, *e)
		return nil
	}
	if err := filepath.WalkDir(dir, walk); err != nil {
		return nil, fmt.Errorf("load corpus %s: %w", dir, err)
	}
	if len(c.entries) == 0 {
		return nil, fmt.Errorf("corpus %s: no .md entries", dir)
	}
	sort.Slice(c.entries, func(i, j int) bool { return c.entries[i].URI < c.entries[j].URI })
	for i := range c.entries {
		c.byURI[c.entries[i].URI] = &c.entries[i]
	}
	return c, nil
}

// parseCorpusEntry splits the leading `---`…`---` YAML frontmatter from the
// markdown body.
func parseCorpusEntry(file string) (*corpusEntry, error) {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", file, err)
	}
	front, body, ok := splitFrontmatter(string(raw))
	if !ok {
		return nil, fmt.Errorf("%s: missing --- frontmatter", file)
	}
	var e corpusEntry
	if uerr := yaml.Unmarshal([]byte(front), &e); uerr != nil {
		return nil, fmt.Errorf("%s frontmatter: %w", file, uerr)
	}
	if e.URI == "" {
		return nil, fmt.Errorf("%s: frontmatter missing uri", file)
	}
	e.Body = strings.TrimSpace(body)
	return &e, nil
}

func splitFrontmatter(s string) (front, body string, ok bool) {
	s = strings.TrimLeft(s, "\ufeff \t\n")
	if !strings.HasPrefix(s, "---\n") {
		return "", "", false
	}
	rest := s[len("---\n"):]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", false
	}
	front = rest[:end]
	body = strings.TrimPrefix(rest[end+len("\n---"):], "\n")
	return front, body, true
}

// searchHit —— one corpus_search result row.
type searchHit struct {
	URI     string `json:"uri"`
	Title   string `json:"title"`
	Kind    string `json:"kind"`
	Snippet string `json:"snippet"`
}

// search ranks entries by weighted keyword match (title 3, tag 2, body 1) over
// the query terms, returning up to limit hits with score > 0.
func (c *corpus) search(query string, limit int) []searchHit {
	terms := strings.Fields(strings.ToLower(query))
	type scored struct {
		e     *corpusEntry
		score int
	}
	ranked := make([]scored, 0, len(c.entries))
	for i := range c.entries {
		if s := scoreEntry(&c.entries[i], terms); s > 0 {
			ranked = append(ranked, scored{e: &c.entries[i], score: s})
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return ranked[i].score > ranked[j].score })
	hits := make([]searchHit, 0, limit)
	for i := 0; i < len(ranked) && i < limit; i++ {
		e := ranked[i].e
		hits = append(hits, searchHit{URI: e.URI, Title: e.Title, Kind: e.Kind, Snippet: snippet(e.Body, terms)})
	}
	return hits
}

func scoreEntry(e *corpusEntry, terms []string) int {
	title := strings.ToLower(e.Title)
	body := strings.ToLower(e.Body)
	tags := strings.ToLower(strings.Join(e.Tags, " "))
	score := 0
	for _, t := range terms {
		if strings.Contains(title, t) {
			score += 3
		}
		if strings.Contains(tags, t) {
			score += 2
		}
		score += strings.Count(body, t)
	}
	return score
}

// snippet returns ~200 chars of body around the first matched term (or the
// head if none match), single-lined for the tool result.
func snippet(body string, terms []string) string {
	flat := strings.Join(strings.Fields(body), " ")
	low := strings.ToLower(flat)
	at := 0
	for _, t := range terms {
		if i := strings.Index(low, t); i >= 0 {
			at = i
			break
		}
	}
	start := at - 60
	if start < 0 {
		start = 0
	}
	end := start + 200
	if end > len(flat) {
		end = len(flat)
	}
	out := flat[start:end]
	if start > 0 {
		out = "…" + out
	}
	if end < len(flat) {
		out += "…"
	}
	return out
}

// corpusToolset builds the corpus_search + corpus_read eino tools over c, plus
// their progress labels. These are real retrieval tools, not canned fixtures.
func corpusToolset(c *corpus) ([]tool.BaseTool, map[string]string) {
	tools := []tool.BaseTool{
		&corpusSearchTool{c: c},
		&corpusReadTool{c: c},
	}
	labels := map[string]string{
		"corpus_search": "searching the corpus",
		"corpus_read":   "reading an entry",
	}
	return tools, labels
}

type corpusSearchTool struct{ c *corpus }

func (t *corpusSearchTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "corpus_search",
		Desc: "Search the owner's curated corpus by keyword. Returns matching entries with uri, title and a snippet.",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"query": {Type: schema.String, Desc: "keywords to search for", Required: true},
		}),
	}, nil
}

func (t *corpusSearchTool) InvokableRun(_ context.Context, argsJSON string, _ ...tool.Option) (string, error) {
	var a struct {
		Query string `json:"query"`
	}
	if err := json.Unmarshal([]byte(argsJSON), &a); err != nil {
		return "", fmt.Errorf("corpus_search args: %w", err)
	}
	hits := t.c.search(a.Query, 5)
	out, err := json.Marshal(hits)
	if err != nil {
		return "", fmt.Errorf("corpus_search marshal: %w", err)
	}
	return string(out), nil
}

type corpusReadTool struct{ c *corpus }

func (t *corpusReadTool) Info(_ context.Context) (*schema.ToolInfo, error) {
	return &schema.ToolInfo{
		Name: "corpus_read",
		Desc: "Read one corpus entry in full by its uri (as returned by corpus_search).",
		ParamsOneOf: schema.NewParamsOneOfByParams(map[string]*schema.ParameterInfo{
			"uri": {Type: schema.String, Desc: "the entry uri, e.g. wiki://project/order-reconciliation", Required: true},
		}),
	}, nil
}

func (t *corpusReadTool) InvokableRun(_ context.Context, argsJSON string, _ ...tool.Option) (string, error) {
	var a struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal([]byte(argsJSON), &a); err != nil {
		return "", fmt.Errorf("corpus_read args: %w", err)
	}
	e, ok := t.c.read(a.URI)
	if !ok {
		return fmt.Sprintf("no corpus entry with uri %q", a.URI), nil
	}
	out, err := json.Marshal(map[string]string{"uri": e.URI, "title": e.Title, "body": e.Body})
	if err != nil {
		return "", fmt.Errorf("corpus_read marshal: %w", err)
	}
	return string(out), nil
}

func (c *corpus) read(uri string) (*corpusEntry, bool) {
	e, ok := c.byURI[uri]
	return e, ok
}
