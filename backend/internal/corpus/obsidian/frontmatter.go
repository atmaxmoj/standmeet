// Package obsidian —— Obsidian vault two-way sync sub-usecases: frontmatter codec /
// image ref rewriter / zip export / multipart import. Goes through usecases.SavePost
// for the atomic asset path.
//
// This file only handles the **mechanical** codec for frontmatter — Split / Parse / Render /
// Assemble. The **field-provenance contract** (which key comes from where, who reads it and
// who ignores it) is not restated here: the authoritative definition lives in the vault
// design doc
// `standmeet/architecture/key-designs/corpus/obsidian-sync-mechanism/protocol.md`
// (with the companion template `_templates/standmeet-article.md`). This comment used to
// carry an inline copy of a schema example that had drifted from the contract (it listed the
// export-only `created` as an import field), and it misled an audit — it has been deleted.
// The contract has exactly one copy; don't re-copy it into a code comment.
//
// `publish: true` is the import gate (the native Obsidian Publish key, one flag meaning the
// same thing on both sides): by default the vault only imports notes carrying this flag,
// to avoid dumping in private drafts wholesale.
package obsidian

import (
	"bytes"
	"fmt"
	"strings"

	"go.yaml.in/yaml/v3"
)

// Frontmatter —— the parsed shape of the YAML block at the top of a .md file. The
// field-provenance contract lives in the protocol.md the package doc points to; this is
// just the codec's parse/render carrier. `created` is not among these fields — the
// timestamps are owned by the DB (created_at / published_at) and never round-trip as a
// frontmatter key.
type Frontmatter struct {
	Title         string   `yaml:"title"`
	Slug          string   `yaml:"slug,omitempty"`
	Excerpt       string   `yaml:"excerpt,omitempty"`
	CoverHeadline string   `yaml:"cover_headline,omitempty"`
	CoverHue      string   `yaml:"cover_hue,omitempty"`
	CoverImage    string   `yaml:"cover_image,omitempty"`
	Visibility    string   `yaml:"visibility,omitempty"`
	LockedBody    string   `yaml:"locked_body,omitempty"`
	Tags          []string `yaml:"tags,omitempty"`
	Aliases       []string `yaml:"aliases,omitempty"`
	Publish       bool     `yaml:"publish,omitempty"`
}

const (
	fmDelim = "---"
	newline = "\n"
)

// SplitParts —— the return of SplitFrontmatter.
type SplitParts struct {
	YAML string
	Body string
}

// SplitFrontmatter —— splits .md file content into frontmatter YAML + body. When there's
// no frontmatter block, YAML="", Body=whole-content. Obsidian's rule: a file is only
// considered to have frontmatter if it starts with "---\n"; otherwise it's raw markdown.
func SplitFrontmatter(content string) SplitParts {
	if !strings.HasPrefix(content, fmDelim+newline) &&
		!strings.HasPrefix(content, fmDelim+"\r\n") {
		return SplitParts{YAML: "", Body: content}
	}
	rest := content[len(fmDelim):]
	rest = strings.TrimLeft(rest, "\r\n")
	end := findFrontmatterEnd(rest)
	if end < 0 {
		return SplitParts{YAML: "", Body: content}
	}
	return SplitParts{
		YAML: rest[:end],
		Body: strings.TrimLeft(rest[end+len(fmDelim):], "\r\n"),
	}
}

// findFrontmatterEnd —— finds the start offset of "\n---" (the closing fence).
func findFrontmatterEnd(s string) int {
	markers := []string{
		newline + fmDelim + newline,
		newline + fmDelim + "\r\n",
		newline + fmDelim,
	}
	for _, marker := range markers {
		if i := strings.Index(s, marker); i >= 0 {
			return i + 1
		}
	}
	return -1
}

// ParseFrontmatter —— parses a frontmatter YAML string into a Frontmatter struct.
// Returns an error on YAML parse failure; an empty string returns the zero value + nil.
func ParseFrontmatter(yamlBlock string) (Frontmatter, error) {
	var fm Frontmatter
	if yamlBlock == "" {
		return fm, nil
	}
	if err := yaml.Unmarshal([]byte(yamlBlock), &fm); err != nil {
		return Frontmatter{}, fmt.Errorf("parse frontmatter yaml: %w", err)
	}
	return fm, nil
}

// RenderFrontmatter —— Frontmatter struct → a "---\n...\n---\n" block. omitempty
// fields are not written out (less noise). Output always has a trailing newline, so it can
// be concatenated with the body directly.
func RenderFrontmatter(fm *Frontmatter) (string, error) {
	var buf bytes.Buffer
	// bytes.Buffer.WriteString never returns an error (guaranteed by its doc), safe to swallow.
	_, _ = buf.WriteString(fmDelim + newline)
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(fm); err != nil {
		return "", fmt.Errorf("encode frontmatter yaml: %w", err)
	}
	if cerr := enc.Close(); cerr != nil {
		return "", fmt.Errorf("close yaml encoder: %w", cerr)
	}
	_, _ = buf.WriteString(fmDelim + newline)
	return buf.String(), nil
}

// AssembleMarkdown —— joins frontmatter + body into complete .md file content. A trailing
// newline is auto-appended to the body to avoid warnings in the owner's editor
// (Obsidian / VS Code).
func AssembleMarkdown(fm *Frontmatter, body string) (string, error) {
	head, err := RenderFrontmatter(fm)
	if err != nil {
		return "", err
	}
	if !strings.HasSuffix(body, newline) {
		body += newline
	}
	return head + newline + body, nil
}
