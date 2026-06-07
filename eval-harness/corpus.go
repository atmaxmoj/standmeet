package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// corpusEntry —— one piece of the owner's curated corpus, loaded from a
// markdown file with a YAML frontmatter block. Mirrors what the owner would
// have pushed via MCP (raw_dump / promote_to_wiki).
type corpusEntry struct {
	URI string `yaml:"uri"`
	// Visibility —— "public" (default) or "private". Mirrors the backend corpus
	// ACL (domain.Raw.FlaggedPrivate / Writing.Visibility): the visitor
	// retriever skips private entries entirely, so the agent never sees owner-
	// private material and structurally cannot leak it. Enforced here in the
	// retrieval layer (code), NOT by asking the prompt to self-censor.
	Visibility string   `yaml:"visibility"`
	Title      string   `yaml:"title"`
	Kind       string   `yaml:"kind"`
	Tags       []string `yaml:"tags"`
	Body       string   `yaml:"-"`
}

func (e *corpusEntry) isPrivate() bool { return e.Visibility == "private" }

// corpus —— the loaded persona corpus. Parsed from fixture .md files and handed
// to the facade (toVisitorCorpus) which builds the REAL retriever over it; the
// eval no longer reimplements search/read/list itself.
type corpus struct {
	entries []corpusEntry
}

// loadCorpus reads every .md under dir, parsing frontmatter + body.
func loadCorpus(dir string) (*corpus, error) {
	c := &corpus{}
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

// toVisitorCorpus maps the loaded fixture corpus into the facade's plain entry
// shape. Genre comes from the URI scheme: output:// → "output", everything else
// (wiki:// and the owner's raw:// working notes) folds into the visitor's
// curated "wiki" layer — in prod the visitor retriever only ever sees curated
// wiki/output, never raw, so raw fixtures stand in as wiki entries the owner
// promoted. Privacy is code-level: a private entry's URI is withheld from the
// granted whitelist (Private=true), so the real retriever's ACL denies it at
// search/read/list — the agent structurally cannot reach it.
func toVisitorCorpus(c *corpus) []agentcore.VisitorCorpusEntry {
	out := make([]agentcore.VisitorCorpusEntry, 0, len(c.entries))
	for i := range c.entries {
		e := &c.entries[i]
		genre, path := splitURI(e.URI)
		if genre != "output" {
			genre = "wiki"
		}
		out = append(out, agentcore.VisitorCorpusEntry{
			Genre: genre, Path: path, Title: e.Title, Body: e.Body,
			Tags: e.Tags, Private: e.isPrivate(),
		})
	}
	return out
}

// splitURI splits "wiki://profile/overview" into ("wiki", "profile/overview").
// A scheme-less uri falls back to the wiki genre with the whole string as path.
func splitURI(uri string) (scheme, path string) {
	if i := strings.Index(uri, "://"); i >= 0 {
		return uri[:i], uri[i+len("://"):]
	}
	return "wiki", uri
}
