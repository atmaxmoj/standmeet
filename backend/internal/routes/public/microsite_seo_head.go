// microsite_seo_head.go — the per-page SEO <head> tags injected when serving a microsite: the
// <title> + meta description, plus Open Graph + Twitter Card tags so a shared link renders a
// preview card. Split out of microsites.go to keep that file under the max-lines cap.

package public

import "html"

// seoHead — every SEO/OG/Twitter tag whose value is set. A page with no SEO injects nothing, so it
// keeps whatever <title> its build has. og:title/description reuse the SEO title/description.
func seoHead(title, desc, image *string) string {
	return seoTitleTag(title) +
		metaName("description", desc) +
		ogTags(title, desc, image) +
		twitterTags(title, desc, image)
}

func seoTitleTag(t *string) string {
	if emptyPtr(t) {
		return ""
	}
	return "<title>" + html.EscapeString(*t) + "</title>"
}

// ogTags — Open Graph (Facebook, LinkedIn, most chat apps). og:type is emitted whenever the page
// has any SEO at all, so a card renders even with only a title.
func ogTags(title, desc, image *string) string {
	return metaProp("og:title", title) + metaProp("og:description", desc) +
		metaProp("og:image", image) + ogType(title, desc, image)
}

func ogType(title, desc, image *string) string {
	if hasAnySEO(title, desc, image) {
		return `<meta property="og:type" content="website">`
	}
	return ""
}

func hasAnySEO(title, desc, image *string) bool {
	return !emptyPtr(title) || !emptyPtr(desc) || !emptyPtr(image)
}

// twitterTags — Twitter/X card. summary_large_image when there's an image, otherwise summary.
func twitterTags(title, desc, image *string) string {
	return twitterCard(title, desc, image) +
		metaName("twitter:title", title) + metaName("twitter:description", desc) +
		metaName("twitter:image", image)
}

func twitterCard(title, desc, image *string) string {
	if !emptyPtr(image) {
		return `<meta name="twitter:card" content="summary_large_image">`
	}
	if hasTitleOrDesc(title, desc) {
		return `<meta name="twitter:card" content="summary">`
	}
	return ""
}

func hasTitleOrDesc(title, desc *string) bool {
	return !emptyPtr(title) || !emptyPtr(desc)
}

func metaProp(property string, v *string) string {
	if emptyPtr(v) {
		return ""
	}
	return `<meta property="` + property + `" content="` + html.EscapeString(*v) + `">`
}

func metaName(name string, v *string) string {
	if emptyPtr(v) {
		return ""
	}
	return `<meta name="` + name + `" content="` + html.EscapeString(*v) + `">`
}

func emptyPtr(s *string) bool { return s == nil || *s == "" }
