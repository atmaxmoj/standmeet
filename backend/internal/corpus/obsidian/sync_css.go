// sync_css.go -- harvests owner CSS from .obsidian/snippets/*.css (per the
// enabled list in appearance.json). Concatenates it into raw CSS and hands
// it to SyncCSSPort (the usecase layer sanitizes + scopes it before
// persisting). Matches Obsidian's own behavior: only enabled snippets carry over.

package obsidian

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
)

// SyncCSSPort -- stores owner CSS (SetOwnerCSS sanitizes + scopes it).
type SyncCSSPort interface {
	SetCSS(ctx context.Context, ownerID, rawCSS string) error
}

// cssHarvest -- what's parsed out of the css bucket: the enabled list, each
// snippet's content, and whether appearance.json exists.
type cssHarvest struct {
	enabled       map[string]bool
	snippets      map[string]string
	hasAppearance bool
}

// syncCSS -- concatenates enabled snippets -> SetCSS (best-effort; a
// failure doesn't block the whole sync batch).
func syncCSS(ctx context.Context, deps *SyncDeps, ownerID string, files []VaultFile) {
	if deps.CSS == nil || len(files) == 0 {
		return
	}
	if err := deps.CSS.SetCSS(ctx, ownerID, concatEnabledCSS(harvestCSSFiles(files))); err != nil {
		return
	}
}

// concatEnabledCSS -- concatenates enabled snippet content (or all of them,
// when there's no appearance.json), sorted by name.
func concatEnabledCSS(h cssHarvest) string {
	names := make([]string, 0, len(h.snippets))
	for name := range h.snippets {
		if !h.hasAppearance || h.enabled[name] {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	parts := make([]string, 0, len(names))
	for _, n := range names {
		parts = append(parts, h.snippets[n])
	}
	return strings.Join(parts, "\n")
}

func harvestCSSFiles(files []VaultFile) cssHarvest {
	h := cssHarvest{enabled: map[string]bool{}, snippets: map[string]string{}}
	for i := range files {
		if files[i].RelPath == obsidianAppearance {
			h.enabled = parseEnabledSnippets(files[i].Body)
			h.hasAppearance = true
			continue
		}
		h.snippets[snippetName(files[i].RelPath)] = string(files[i].Body)
	}
	return h
}

func parseEnabledSnippets(body []byte) map[string]bool {
	var cfg struct {
		EnabledCSSSnippets []string `json:"enabledCssSnippets"`
	}
	out := map[string]bool{}
	if json.Unmarshal(body, &cfg) != nil {
		return out
	}
	for _, n := range cfg.EnabledCSSSnippets {
		out[n] = true
	}
	return out
}

func snippetName(rel string) string {
	return strings.TrimSuffix(strings.TrimPrefix(rel, obsidianSnippets), ".css")
}
