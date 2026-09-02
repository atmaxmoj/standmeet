// prompt_fragments.go —— single source for the owner's system-prompt
// fragments (.md + go:embed). Owner just edits the .md, no .go rebuild
// needed; GET /api/v1/prompts/{id} pulls the same-source text.

package entity

import (
	"embed"
	"errors"
	"fmt"
	"path"
	"strings"
)

// capabilities/*.md is now entirely empty — the prompt fragments for the
// four leaf capabilities (corpus.retrieval / calendar.book / summarize /
// ask_visitor) moved with their capabilities into each plugin's own MCP
// `instructions`, and are no longer embedded here. What's left is
// non-capability fragments like visitor-header.md.
//
//go:embed *.md
var promptFS embed.FS

// ErrPromptFragmentNotFound —— LoadPromptFragment's id has no matching .md
// file.
var ErrPromptFragmentNotFound = errors.New("prompts: not found")

// LoadPromptFragment —— returns the fragment text for an id. Trims the
// trailing newline (md files usually have one extra).
func LoadPromptFragment(id string) (string, error) {
	rel, perr := safeRelPath(id)
	if perr != nil {
		return "", perr
	}
	data, err := promptFS.ReadFile(rel)
	if err != nil {
		return "", ErrPromptFragmentNotFound
	}
	return strings.TrimRight(string(data), "\n"), nil
}

// MustLoadPromptFragment —— for ids known at boot time (post-refactor
// capability fragments, etc). Panics if missing — a boot failure beats a
// missing file at runtime.
func MustLoadPromptFragment(id string) string {
	text, err := LoadPromptFragment(id)
	if err != nil {
		panic(fmt.Errorf("prompts.MustLoad(%q): %w", id, err))
	}
	return text
}

// safeRelPath —— guards against .. / absolute path / empty id attacks.
func safeRelPath(id string) (string, error) {
	if id == "" {
		return "", ErrPromptFragmentNotFound
	}
	clean := path.Clean(id)
	if clean != id || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return "", ErrPromptFragmentNotFound
	}
	return clean + ".md", nil
}
