// owner_css.go —— owner 自定义 CSS 的 sanitize + scope(安全核心)。owner CSS 是 user-provided →
// 攻击面:剥 @import(外部拉取/CSP)、外部 url()/javascript:(数据外泄/追踪)、expression()/-moz-binding
// (老式 JS 执行);再把每条规则的选择器锚到 .corpus-content(动不了 app chrome,防 clickjacking/redress)。

package usecases

import (
	"context"
	"regexp"
	"strings"
)

const cssScopePrefix = ".corpus-content"

var (
	reCSSImport = regexp.MustCompile(`(?i)@import[^;]*;`)
	// 除 http(s)/javascript: 外，protocol-relative `url(//host)` 也剥 —— 它照样从页面协议拉外部资源
	// (数据外泄/追踪),跟 https: 同威胁。
	reCSSExternalURL = regexp.MustCompile(`(?i)url\(\s*['"]?\s*(?:https?:|javascript:|//)[^)]*\)?`)
	reCSSExpression  = regexp.MustCompile(`(?i)expression\([^)]*\)`)
	reCSSBinding     = regexp.MustCompile(`(?i)-moz-binding[^;]*;`)
)

// OwnerCSSStore —— owner CSS 存取(postgres.OwnerRepo 实现)。
type OwnerCSSStore interface {
	GetCSS(ctx context.Context, ownerID string) (string, error)
	SetCSS(ctx context.Context, ownerID, css string) error
}

// SetOwnerCSS —— 从任一面(admin/MCP/sync)写 owner CSS:先 sanitize+scope 再存安全版本。
func SetOwnerCSS(ctx context.Context, store OwnerCSSStore, ownerID, raw string) error {
	if err := store.SetCSS(ctx, ownerID, SanitizeAndScopeCSS(raw)); err != nil {
		return err //nolint:wrapcheck // store 已 wrap
	}
	return nil
}

// SanitizeAndScopeCSS —— 剥危险构造 + scope 到 .corpus-content。
func SanitizeAndScopeCSS(raw string) string {
	s := reCSSImport.ReplaceAllString(raw, "")
	s = reCSSExternalURL.ReplaceAllString(s, "url()")
	s = reCSSExpression.ReplaceAllString(s, "")
	s = reCSSBinding.ReplaceAllString(s, "")
	return scopeCSS(s)
}

// scopeCSS —— brace-aware:每个顶层块 scope。@media/@supports 里的嵌套规则必须 recurse 进去
// scope(否则 `@media{ body{…} }` 里的 body 逃出 .corpus-content → 能改 app chrome / clickjacking)。
func scopeCSS(css string) string {
	out := []string{}
	for _, block := range splitTopLevelBlocks(css) {
		if strings.TrimSpace(block) != "" {
			out = append(out, scopeBlock(block))
		}
	}
	return strings.Join(out, "\n")
}

// splitTopLevelBlocks —— 按 brace 深度切成顶层 `... { ... }` 块(尊重嵌套,@media 的外层 } 才收块)。
func splitTopLevelBlocks(css string) []string {
	blocks := []string{}
	depth, start := 0, 0
	for i, r := range css {
		depth = adjustBraceDepth(depth, r)
		if depth == 0 && r == '}' {
			blocks = append(blocks, css[start:i+1])
			start = i + 1
		}
	}
	if strings.TrimSpace(css[start:]) != "" {
		blocks = append(blocks, css[start:])
	}
	return blocks
}

func adjustBraceDepth(depth int, r rune) int {
	if r == '{' {
		return depth + 1
	}
	if r == '}' && depth > 0 {
		return depth - 1
	}
	return depth
}

// scopeBlock —— 一个顶层块:普通规则 scope 选择器;@media/@supports recurse;其它 @-规则
// (@font-face/@keyframes/@page —— 不指向页面元素)原样。
func scopeBlock(block string) string {
	brace := strings.Index(block, "{")
	if brace < 0 {
		return block
	}
	prelude := strings.TrimSpace(block[:brace])
	if strings.HasPrefix(prelude, "@") {
		return scopeAtRule(prelude, block, brace)
	}
	if prelude == "" {
		return block
	}
	return scopeSelectors(prelude) + " " + block[brace:]
}

func scopeAtRule(prelude, block string, brace int) string {
	lower := strings.ToLower(prelude)
	if strings.HasPrefix(lower, "@media") || strings.HasPrefix(lower, "@supports") {
		if closeIdx := strings.LastIndex(block, "}"); closeIdx > brace {
			return prelude + " { " + scopeCSS(block[brace+1:closeIdx]) + " }"
		}
	}
	return block
}

func scopeSelectors(sel string) string {
	scoped := []string{}
	for s := range strings.SplitSeq(sel, ",") {
		if t := strings.TrimSpace(s); t != "" {
			scoped = append(scoped, cssScopePrefix+" "+t)
		}
	}
	return strings.Join(scoped, ", ")
}
