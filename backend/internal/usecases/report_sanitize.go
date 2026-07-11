// report_sanitize.go —— allow-list sanitizer for chat-report HTML. The report body is model output
// (steerable by a hostile visitor / prompt-injected transcript) and is later rendered by a
// network-enabled Gotenberg headless Chromium AND shown in a browser srcDoc iframe. Without
// sanitizing, an `<img src=http://169.254.169.254/…>` / `<link href=…>` makes the renderer fetch an
// internal/attacker URL (SSRF / tracking). We keep only a small set of formatting tags and strip
// every external-resource-loading / scripting element before the HTML is stored or embedded.

package usecases

import (
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// reportAllowedTags —— formatting elements a chat report may keep.
var reportAllowedTags = map[atom.Atom]bool{
	atom.H1: true, atom.H2: true, atom.H3: true, atom.H4: true, atom.P: true,
	atom.Ul: true, atom.Ol: true, atom.Li: true, atom.Strong: true, atom.Em: true,
	atom.B: true, atom.I: true, atom.U: true, atom.Blockquote: true, atom.A: true,
	atom.Br: true, atom.Hr: true, atom.Code: true, atom.Pre: true, atom.Span: true,
	atom.Div: true, atom.Table: true, atom.Thead: true, atom.Tbody: true, atom.Tfoot: true,
	atom.Tr: true, atom.Td: true, atom.Th: true,
}

// reportVoidTags —— allowed elements that take no closing tag.
var reportVoidTags = map[atom.Atom]bool{atom.Br: true, atom.Hr: true}

// reportDroppedTags —— dropped WITH their subtree: they load external resources or execute.
// Anything else not in the allow-list is UNWRAPPED (text kept, tag removed).
var reportDroppedTags = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Img: true, atom.Link: true, atom.Iframe: true,
	atom.Object: true, atom.Embed: true, atom.Svg: true, atom.Math: true, atom.Base: true,
	atom.Meta: true, atom.Form: true, atom.Input: true, atom.Button: true, atom.Video: true,
	atom.Audio: true, atom.Source: true, atom.Picture: true,
}

// SanitizeReportHTML —— allow-list sanitize a chat-report HTML fragment. On a parse error it
// returns empty (safe) rather than the raw input.
func SanitizeReportHTML(fragment string) string {
	body := &html.Node{Type: html.ElementNode, Data: "body", DataAtom: atom.Body}
	nodes, err := html.ParseFragment(strings.NewReader(fragment), body)
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, n := range nodes {
		sanitizeReportNode(&b, n)
	}
	return b.String()
}

func sanitizeReportNode(b *strings.Builder, n *html.Node) {
	if n.Type == html.TextNode {
		_, _ = b.WriteString(html.EscapeString(n.Data))
		return
	}
	if n.Type != html.ElementNode || reportDroppedTags[n.DataAtom] {
		return
	}
	if !reportAllowedTags[n.DataAtom] {
		sanitizeReportChildren(b, n) // unwrap: keep text, drop the tag
		return
	}
	writeReportElement(b, n)
}

func sanitizeReportChildren(b *strings.Builder, n *html.Node) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		sanitizeReportNode(b, c)
	}
}

func writeReportElement(b *strings.Builder, n *html.Node) {
	_, _ = b.WriteString("<" + n.Data)
	for _, a := range n.Attr {
		if safeReportAttr(n.DataAtom, a) {
			_, _ = b.WriteString(" " + a.Key + `="` + html.EscapeString(a.Val) + `"`)
		}
	}
	_, _ = b.WriteString(">")
	if reportVoidTags[n.DataAtom] {
		return
	}
	sanitizeReportChildren(b, n)
	_, _ = b.WriteString("</" + n.Data + ">")
}

// safeReportAttr —— keep only `class` + a safe http(s)/mailto/# href on <a>. Drops src, style, on*,
// and any javascript:/data:/protocol-relative href → no external fetch, no script.
func safeReportAttr(tag atom.Atom, a html.Attribute) bool {
	if a.Namespace != "" {
		return false
	}
	if strings.EqualFold(a.Key, "class") {
		return true
	}
	if tag == atom.A && strings.EqualFold(a.Key, "href") {
		return safeReportHref(a.Val)
	}
	return false
}

func safeReportHref(v string) bool {
	s := strings.ToLower(strings.TrimSpace(v))
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") ||
		strings.HasPrefix(s, "mailto:") || strings.HasPrefix(s, "#")
}
