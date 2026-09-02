// owner_css.go — sanitize + scope for owner-provided custom CSS (a security core).
// Owner CSS is user-provided -> attack surface: strip @import (external fetch/CSP),
// external url()/javascript: (data exfil/tracking), expression()/-moz-binding (legacy JS
// execution); then anchor every rule's selector to .corpus-content (can't touch the app
// chrome, defends against clickjacking/redress).

package usecase

import (
	"context"
	"regexp"
	"strings"
)

const cssScopePrefix = ".corpus-content"

var (
	reCSSImport = regexp.MustCompile(`(?i)@import[^;]*;`)
	// Besides http(s)/javascript:, protocol-relative `url(//host)` is stripped too — it
	// still fetches an external resource under the page's protocol (data exfil/tracking),
	// the same threat as https:.
	reCSSExternalURL = regexp.MustCompile(`(?i)url\(\s*['"]?\s*(?:https?:|javascript:|//)[^)]*\)?`)
	reCSSExpression  = regexp.MustCompile(`(?i)expression\([^)]*\)`)
	reCSSBinding     = regexp.MustCompile(`(?i)-moz-binding[^;]*;`)
)

// CSSStore — owner CSS storage/retrieval (implemented by Repo).
type CSSStore interface {
	GetCSS(ctx context.Context, ownerID string) (string, error)
	SetCSS(ctx context.Context, ownerID, css string) error
}

// SetOwnerCSS — writes owner CSS from any surface (admin/MCP/sync): sanitize+scope
// first, then store the safe version.
func SetOwnerCSS(ctx context.Context, store CSSStore, ownerID, raw string) error {
	if err := store.SetCSS(ctx, ownerID, SanitizeAndScopeCSS(raw)); err != nil {
		return err //nolint:wrapcheck // store already wraps
	}
	return nil
}

// SanitizeAndScopeCSS — strips dangerous constructs + scopes to .corpus-content.
func SanitizeAndScopeCSS(raw string) string {
	s := reCSSImport.ReplaceAllString(raw, "")
	s = reCSSExternalURL.ReplaceAllString(s, "url()")
	s = reCSSExpression.ReplaceAllString(s, "")
	s = reCSSBinding.ReplaceAllString(s, "")
	return scopeCSS(s)
}

// scopeCSS — brace-aware: scopes every top-level block. Nested rules inside
// @media/@supports must be recursed into and scoped too (otherwise the body in
// `@media{ body{...} }` escapes .corpus-content -> can alter the app chrome / clickjacking).
func scopeCSS(css string) string {
	out := []string{}
	for _, block := range splitTopLevelBlocks(css) {
		if strings.TrimSpace(block) != "" {
			out = append(out, scopeBlock(block))
		}
	}
	return strings.Join(out, "\n")
}

// splitTopLevelBlocks — splits into top-level `... { ... }` blocks by brace depth
// (respects nesting; only @media's outer } closes a block).
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

// scopeBlock — for one top-level block: a normal rule gets its selector scoped;
// @media/@supports recurses; other @-rules (@font-face/@keyframes/@page — which don't
// target page elements) pass through unchanged.
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

// scopeSelectors — prefixes each selector in the list, one by one.
//
// **Comments are pulled out before splitting on commas** (F-R-7): prelude is "everything
// before the first `{`", so a comment sitting above the rule is included in full. Splitting
// on commas directly would treat commas inside the comment as selector separators — the
// real vault's `i18n-switch.css` ended up stored as
// `... switch, .corpus-content pure CSS, .corpus-content NO JavaScript ...` because of this.
// The comment is reattached unchanged in front of the selectors: it targets no element,
// needs no scoping, and must not be rewritten.
func scopeSelectors(sel string) string {
	p := splitLeadingComments(sel)
	scoped := []string{}
	for s := range strings.SplitSeq(p.selectors, ",") {
		if t := strings.TrimSpace(s); t != "" {
			scoped = append(scoped, cssScopePrefix+" "+t)
		}
	}
	return p.comments + strings.Join(scoped, ", ")
}

// prelude — the two halves after splitting apart everything before the first `{`.
// **A struct, not two string return values**: this repo's linter rejects two
// same-typed return values (it's either confusing-results or nonamedreturns, and the
// two rules fight each other), and these two halves are naturally two faces of one thing
// anyway.
type prelude struct {
	comments  string
	selectors string
}

// splitLeadingComments — strips off a run of leading `/* ... */` comments (including
// whitespace between them) at the start of prelude, and returns
// (the comment text verbatim, the remaining selector list). An unclosed `/*` counts as a
// comment for its entire remainder: that's not a selector, and prefixing it would only
// make things worse.
func splitLeadingComments(sel string) prelude {
	lead, rest := "", strings.TrimLeft(sel, " \t\r\n")
	for strings.HasPrefix(rest, "/*") {
		end := strings.Index(rest, "*/")
		if end < 0 {
			return prelude{comments: lead + rest}
		}
		lead += rest[:end+2] + "\n"
		rest = strings.TrimLeft(rest[end+2:], " \t\r\n")
	}
	return prelude{comments: lead, selectors: rest}
}
