// posts_markdown.go —— posts.go 拆出来的 markdown→blocks parser +
// read-time 估算。owner 手写编辑器走这里；MCP 直接传 blocks 绕过。

package usecases

import (
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
)

// estimateReadMinutes —— 粗算阅读时间 (~225 wpm)。
func estimateReadMinutes(body []domain.PostBlock) int32 {
	var words int
	for i := range body {
		words += len(strings.Fields(body[i].Text))
	}
	return max(int32((words+readWPM-1)/readWPM), 1)
}

const readWPM = 225

// ParseMarkdownBlocks —— owner 手写 markdown → 渲染 blocks。规则极简：
//   - 空行分块；
//   - 行首 "## " → kind="h"；
//   - 行首 "> " → kind="pull"；
//   - 否则 kind="p"。
//
// 同 block 内多行合并空格。MCP `post_create` 传 blocks 绕过这层。
func ParseMarkdownBlocks(md string) []domain.PostBlock {
	chunks := splitParagraphs(md)
	out := make([]domain.PostBlock, 0, len(chunks))
	for _, c := range chunks {
		if block, ok := buildPostBlock(c); ok {
			out = append(out, block)
		}
	}
	return out
}

func splitParagraphs(md string) []string {
	lines := strings.Split(md, "\n")
	var (
		out  []string
		buf  []string
		seal = func() {
			if len(buf) == 0 {
				return
			}
			out = append(out, strings.TrimSpace(strings.Join(buf, " ")))
			buf = buf[:0]
		}
	)
	for _, ln := range lines {
		if strings.TrimSpace(ln) == "" {
			seal()
			continue
		}
		buf = append(buf, ln)
	}
	seal()
	return out
}

func buildPostBlock(chunk string) (domain.PostBlock, bool) {
	c := strings.TrimSpace(chunk)
	if c == "" {
		return domain.PostBlock{}, false
	}
	if rest, ok := strings.CutPrefix(c, "## "); ok {
		return domain.PostBlock{Kind: "h", Text: strings.TrimSpace(rest)}, true
	}
	if rest, ok := strings.CutPrefix(c, "> "); ok {
		return domain.PostBlock{Kind: "pull", Text: strings.TrimSpace(rest)}, true
	}
	return domain.PostBlock{Kind: "p", Text: c}, true
}
