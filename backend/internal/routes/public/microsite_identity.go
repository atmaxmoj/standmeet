// microsite_identity.go —— what a crawler learns about whose site this is, from the raw HTML: the
// page's canonical URL (+ og:url), and on the homepage a schema.org Person naming the owner and a
// <title> that falls back to the owner's name. Found 2026-09-30: an owner searching Google for
// their own name did not find their site, and none of these signals existed.

package public

import (
	"encoding/json"
	"html"
	"regexp"
	"strings"
)

// siteIdentity —— plain values the caller reads off the live page (this file reaches no domain:
// check-routes-via-dispatcher).
type siteIdentity struct {
	ownerName string
	publicURL string
	slug      string
	home      bool // the site root, not /p/<slug>
}

// applyIdentity —— fill the crawler-facing identity of a live page from the owner it belongs to.
func applyIdentity(asset *BuiltAsset, id *siteIdentity) {
	asset.Canonical = canonicalFor(id)
	if !id.home {
		return
	}
	asset.PersonLD = personLD(id.ownerName, id.publicURL)
	if asset.SeoTitle == nil {
		asset.SeoTitle = optStr(id.ownerName)
	}
}

// canonicalFor —— the page's one address, in the same form the sitemap lists it.
func canonicalFor(id *siteIdentity) string {
	if id.publicURL == "" {
		return ""
	}
	if id.home {
		return id.publicURL
	}
	return id.publicURL + "/p/" + id.slug
}

// personLD —— a schema.org Person for the owner ("" when the owner has no name yet). json.Marshal
// escapes < > &, so the value cannot close the <script> it sits in.
func personLD(name, url string) string {
	if name == "" {
		return ""
	}
	b, err := json.Marshal(map[string]string{
		"@context": "https://schema.org", "@type": "Person", "name": name, "url": url,
	})
	if err != nil {
		return ""
	}
	return string(b)
}

// identityTags —— canonical + og:url + the JSON-LD block; each only when set.
func identityTags(canonical, ld string) string {
	var b strings.Builder
	if canonical != "" {
		c := html.EscapeString(canonical)
		b.WriteString(`<link rel="canonical" href="` + c + `">`)
		b.WriteString(`<meta property="og:url" content="` + c + `">`)
	}
	if ld != "" {
		b.WriteString(`<script type="application/ld+json">` + ld + `</script>`)
	}
	return b.String()
}

var (
	existingTitle       = regexp.MustCompile(`(?is)<title[^>]*>.*?</title>`)
	existingDescription = regexp.MustCompile(`(?i)<meta\s+name=["']description["'][^>]*>`)
	svgRegion           = regexp.MustCompile(`(?is)<svg\b.*?</svg>`)
)

// withoutReplaced —— the page's own <title> / description removed when the injected SEO sets one,
// so a crawler reads exactly one of each (the live homepage had two of both: its template's and
// its JSX's, which React renders into <body> during the prerender). A <title> inside an <svg> is an
// accessible name, not the page's title, and is kept.
func withoutReplaced(body string, head *pageHead) string {
	strip := func(s string) string {
		if !emptyPtr(head.seoTitle) {
			s = existingTitle.ReplaceAllString(s, "")
		}
		if !emptyPtr(head.seoDescription) {
			s = existingDescription.ReplaceAllString(s, "")
		}
		return s
	}
	return outsideSVG(body, strip)
}

// outsideSVG —— apply f to every stretch of body that is not inside an <svg>…</svg>.
func outsideSVG(body string, f func(string) string) string {
	var b strings.Builder
	last := 0
	for _, loc := range svgRegion.FindAllStringIndex(body, -1) {
		b.WriteString(f(body[last:loc[0]]))
		b.WriteString(body[loc[0]:loc[1]])
		last = loc[1]
	}
	b.WriteString(f(body[last:]))
	return b.String()
}
