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
	reCSSImport      = regexp.MustCompile(`(?i)@import[^;]*;`)
	reCSSExternalURL = regexp.MustCompile(`(?i)url\(\s*['"]?\s*(?:https?:|javascript:)[^)]*\)?`)
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

func scopeCSS(css string) string {
	out := []string{}
	for rule := range strings.SplitAfterSeq(css, "}") {
		if strings.TrimSpace(rule) != "" {
			out = append(out, scopeRule(rule))
		}
	}
	return strings.Join(out, "\n")
}

// scopeRule —— 一条规则的选择器前加 .corpus-content;@media/@keyframes 等 @-规则原样(v1)。
func scopeRule(rule string) string {
	brace := strings.Index(rule, "{")
	if brace < 0 {
		return rule
	}
	sel := strings.TrimSpace(rule[:brace])
	if sel == "" || strings.HasPrefix(sel, "@") {
		return rule
	}
	return scopeSelectors(sel) + " " + rule[brace:]
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
