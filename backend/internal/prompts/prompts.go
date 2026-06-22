// Package prompts —— Phase D-1: system prompt fragments 单一源。
//
// 原本硬编码在 Go 字符串里 (visitorHeader / retrieval cap / calendar cap)，
// 抽到 .md 文件 + go:embed 加载。owner 编辑 fragment 改 .md 即可，不用
// 改 .go + rebuild backend。Frontend (D 之后 pi-agent-core 装 system prompt
// 时) 通过 GET /api/v1/prompts/{id} 拉同源文本。
//
// id 形态：相对 prompts/ 目录的路径无 .md 后缀。
//
//	"visitor-header"                       → visitor-header.md
//	"capabilities/corpus.retrieval"        → capabilities/corpus.retrieval.md
//
// 不存在的 id 返 ErrPromptNotFound (handler 翻 404)。
package prompts

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

// ErrPromptNotFound —— Load 的 id 没对应 .md 文件。
var ErrPromptNotFound = errors.New("prompts: not found")

// Load —— 按 id 返 fragment 文本。trim 末尾换行 (md 文件通常多一个尾换行)。
func Load(id string) (string, error) {
	rel, perr := safeRelPath(id)
	if perr != nil {
		return "", perr
	}
	data, err := promptFS.ReadFile(rel)
	if err != nil {
		return "", ErrPromptNotFound
	}
	return strings.TrimRight(string(data), "\n"), nil
}

// MustLoad —— 启动期已知 id (refactor 后的 capability fragment 等)。
// 不存在 panic — boot 失败比运行时漏文件好。
func MustLoad(id string) string {
	text, err := Load(id)
	if err != nil {
		panic(fmt.Errorf("prompts.MustLoad(%q): %w", id, err))
	}
	return text
}

// safeRelPath —— 防止 .. / 绝对路径 / 空 id 攻击。
func safeRelPath(id string) (string, error) {
	if id == "" {
		return "", ErrPromptNotFound
	}
	clean := path.Clean(id)
	if clean != id || strings.HasPrefix(clean, "/") || strings.Contains(clean, "..") {
		return "", ErrPromptNotFound
	}
	return clean + ".md", nil
}
