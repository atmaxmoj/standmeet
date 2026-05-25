// posts_text.go —— markdown text helpers: strip-to-plain (for visitor chat
// retriever bag-of-words 索引) + read-time 估算 (~225 wpm)。
//
// 不引 goldmark：retrieval 精度只需 bag-of-words，30 行 regex 够用。如果未来
// 需要 AST 级语义（比如 cross-ref 解析），再换 goldmark。

package usecases

import (
	"regexp"
	"strings"
)

const readWPM = 225

// estimateReadMinutes —— 粗算阅读时间。整段 markdown 上数 word，markdown 符号
// 占比小 (<10%) 误差可忽略；至少 1 分钟。
func estimateReadMinutes(bodyMD string) int32 {
	if bodyMD == "" {
		return 0
	}
	words := len(strings.Fields(StripMarkdown(bodyMD)))
	return max(int32((words+readWPM-1)/readWPM), 1)
}

// markdownStripPatterns —— 顺序敏感：fence block 必须先于其他规则吃掉
// （fence 内 ` 是 literal 不应当 inline code 处理）。
var markdownStripPatterns = []*regexp.Regexp{
	regexp.MustCompile("(?s)```[a-zA-Z0-9_+-]*\n.*?\n```"), // fenced code block
	regexp.MustCompile("`[^`]+`"),                          // inline code
	regexp.MustCompile(`!\[([^\]]*)\]\([^)]+\)`),           // image → alt
	regexp.MustCompile(`\[([^\]]+)\]\([^)]+\)`),            // link → text
	regexp.MustCompile(`(?m)^#{1,6}\s+`),                   // heading marker
	regexp.MustCompile(`(?m)^>\s?`),                        // blockquote marker
	regexp.MustCompile(`(?m)^[-*+]\s+`),                    // bullet marker
	regexp.MustCompile(`(?m)^\d+\.\s+`),                    // numbered marker
	regexp.MustCompile(`(?m)^-{3,}\s*$`),                   // horizontal rule
	regexp.MustCompile(`\*\*([^*]+)\*\*`),                  // bold
	regexp.MustCompile(`__([^_]+)__`),                      // bold alt
	regexp.MustCompile(`\*([^*]+)\*`),                      // italic
	regexp.MustCompile(`_([^_]+)_`),                        // italic alt
	regexp.MustCompile(`~~([^~]+)~~`),                      // strike
}

// markdownStripReplacements —— 跟 markdownStripPatterns index 对齐。空串 = 整段
// 删；"$1" = 抽出捕获组（链接文本 / alt / bold 内文等）。
var markdownStripReplacements = []string{
	"", "$1", "$1", "$1", "", "", "", "", "", "$1", "$1", "$1", "$1", "$1",
}

// StripMarkdown —— 把 markdown 砸成 plain text。给 retriever bag-of-words /
// 估算 word count 用。不保证语义完整，保证不漏字。
func StripMarkdown(md string) string {
	out := md
	for i, p := range markdownStripPatterns {
		out = p.ReplaceAllString(out, markdownStripReplacements[i])
	}
	return strings.TrimSpace(collapseWhitespace(out))
}

var whitespaceRe = regexp.MustCompile(`\s+`)

func collapseWhitespace(s string) string {
	return whitespaceRe.ReplaceAllString(s, " ")
}
