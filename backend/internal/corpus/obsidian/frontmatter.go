// Package obsidian —— Obsidian vault 双向 sync 子用例：frontmatter codec /
// image ref rewriter / zip export / multipart import。靠 usecases.SavePost
// 走 atomic asset 路径。
//
// 本文件只负责 frontmatter 的**机械** codec —— Split / Parse / Render /
// Assemble。**字段来源契约**(哪个 key 从哪来、谁读谁忽略)不在这里复述:权威
// 定义在 vault 设计文档
// `standmeet/architecture/key-designs/corpus/obsidian-sync-mechanism/protocol.md`
// (配套模板 `_templates/standmeet-article.md`)。以前这段注释内联抄过一份 schema
// 例子、并跟契约漂移(把 export-only 的 `created` 当 import 字段列出来),误导过审计,
// 已删 —— 契约只有一份,别在 code 注释里再抄一份。
//
// `publish: true` 是 import gate(Obsidian Publish 的原生 key,一个 flag 两边同义):
// vault 里默认只 import 带这条 flag 的 note,避免一次性灌私人草稿。
package obsidian

import (
	"bytes"
	"fmt"
	"strings"

	"go.yaml.in/yaml/v3"
)

// Frontmatter —— 一个 .md 文件顶部 YAML 块的解析后形态。字段来源契约见 package
// doc 指向的 protocol.md;这里只是 codec 的解析/渲染载体。`created` 不在其中 ——
// 时间戳 DB 拥有(created_at / published_at),不作为 frontmatter key 往返。
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
