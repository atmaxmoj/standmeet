// Package obsidian —— Obsidian vault 双向 sync 子用例：frontmatter codec /
// image ref rewriter / zip export / multipart import。靠 usecases.SavePost
// 走 atomic asset 路径。
//
// 形态对齐 Obsidian Properties (1.4+) + Hugo/Jekyll 公约：
//
//	---
//	title: My Post
//	slug: my-post
//	tags:
//	  - essay
//	aliases: []
//	created: 2026-05-25T10:00:00
//	publish: true
//	excerpt: One-liner.
//	cover_hue: amber
//	cover_headline: cover.
//	cover_sub: image.
//	visibility: public
//	---
//	body markdown here
//
// `tags` / `aliases` 是 Obsidian native typed list field（plural 形态）；
// `created` 是 native datetime；其余 (slug/excerpt/cover_*/visibility) 是
// 我们 custom field，Obsidian 会按 string 显示但不 validate。
//
// `publish: true` 是开源项目 obsidian-publish-plugin 推广的 import gate
// convention —— vault 里默认只 import 带这条 flag 的 note，避免一次性灌
// 私人草稿。
package obsidian

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// Frontmatter —— 一个 .md 文件顶部 YAML 块的解析后形态。
// fieldalignment: slice (24B) → string (16B) → bool (1B)。
type Frontmatter struct {
	Created       *time.Time `yaml:"created,omitempty"`
	Title         string     `yaml:"title"`
	Slug          string     `yaml:"slug,omitempty"`
	Excerpt       string     `yaml:"excerpt,omitempty"`
	CoverHeadline string     `yaml:"cover_headline,omitempty"`
	CoverSub      string     `yaml:"cover_sub,omitempty"`
	CoverHue      string     `yaml:"cover_hue,omitempty"`
	CoverImage    string     `yaml:"cover_image,omitempty"`
	Visibility    string     `yaml:"visibility,omitempty"`
	LockedBody    string     `yaml:"locked_body,omitempty"`
	Tags          []string   `yaml:"tags,omitempty"`
	Aliases       []string   `yaml:"aliases,omitempty"`
	Publish       bool       `yaml:"publish,omitempty"`
}

const (
	fmDelim = "---"
	newline = "\n"
)

// SplitParts —— SplitFrontmatter 的返回。
type SplitParts struct {
	YAML string
	Body string
}

// SplitFrontmatter —— 把 .md 文件内容切成 frontmatter YAML + body。没有
// frontmatter 块时 YAML="", Body=whole-content。Obsidian 规则：文件必须以
// "---\n" 起始才被认为有 frontmatter，否则当 raw markdown。
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

// findFrontmatterEnd —— 找到 "\n---" (closing fence) 的起始 offset。
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

// ParseFrontmatter —— 解析 frontmatter YAML 字符串到 Frontmatter struct。
// YAML 解析失败返 error；空字符串返零值 + nil。
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

// RenderFrontmatter —— Frontmatter struct → "---\n...\n---\n" 块。omitempty
// 字段不写出来 (减 noise)。output 永远 trailing newline，方便直接拼 body。
func RenderFrontmatter(fm *Frontmatter) (string, error) {
	var buf bytes.Buffer
	// bytes.Buffer.WriteString 永远不报 error（doc 保证），可以 swallow。
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

// AssembleMarkdown —— frontmatter + body 拼成完整 .md 文件内容。body 末尾
// 自动补 trailing newline 避免 owner 编辑器 (Obsidian / VS Code) 警告。
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
