// sync_css.go —— 从 .obsidian/snippets/*.css(按 appearance.json 的 enabled 列表)harvest owner CSS。
// 拼成 raw CSS 交给 SyncCSSPort(usecase 层再 sanitize+scope 落库)。跟 Obsidian 一致:只搬启用的。

package obsidian

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
)

// SyncCSSPort —— owner CSS 存(SetOwnerCSS 会 sanitize+scope)。
type SyncCSSPort interface {
	SetCSS(ctx context.Context, ownerID, rawCSS string) error
}

// cssHarvest —— 从 css 桶解出的:启用列表 + 各 snippet 内容 + 是否有 appearance.json。
type cssHarvest struct {
	enabled       map[string]bool
	snippets      map[string]string
	hasAppearance bool
}

// syncCSS —— 拼启用的 snippet → SetCSS(best-effort;失败不阻塞整批 sync)。
func syncCSS(ctx context.Context, deps *SyncDeps, ownerID string, files []VaultFile) {
	if deps.CSS == nil || len(files) == 0 {
		return
	}
	if err := deps.CSS.SetCSS(ctx, ownerID, concatEnabledCSS(harvestCSSFiles(files))); err != nil {
		return
	}
}

// concatEnabledCSS —— 按名字序拼接启用(或无 appearance 时全部)的 snippet 内容。
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
