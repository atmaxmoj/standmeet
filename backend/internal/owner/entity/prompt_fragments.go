// prompt_fragments.go —— owner 的 system-prompt fragment 单一源(.md + go:embed)。
// owner 改 .md 即可,不用改 .go rebuild;GET /api/v1/prompts/{id} 拉同源文本。

package entity

import (
	"embed"
	"errors"
	"fmt"
	"path"
	"strings"
)

// capabilities/*.md 全空了 —— 四个 leaf 能力（corpus.retrieval / calendar.book /
// summarize / ask_visitor）的 prompt fragment 都随能力外置进了各自插件的 MCP
// `instructions`，不再从这里 embed。剩 visitor-header.md 等非能力 fragment。
//
//go:embed *.md
var promptFS embed.FS

// ErrPromptFragmentNotFound —— LoadPromptFragment 的 id 没对应 .md 文件。
var ErrPromptFragmentNotFound = errors.New("prompts: not found")

// LoadPromptFragment —— 按 id 返 fragment 文本。trim 末尾换行 (md 文件通常多一个尾换行)。
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

// MustLoadPromptFragment —— 启动期已知 id (refactor 后的 capability fragment 等)。
// 不存在 panic — boot 失败比运行时漏文件好。
func MustLoadPromptFragment(id string) string {
	text, err := LoadPromptFragment(id)
	if err != nil {
		panic(fmt.Errorf("prompts.MustLoad(%q): %w", id, err))
	}
	return text
}

// safeRelPath —— 防止 .. / 绝对路径 / 空 id 攻击。
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
