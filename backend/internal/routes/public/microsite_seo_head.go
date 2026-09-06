// microsite_seo_head.go — the per-page SEO <head> tags injected when serving a microsite. Split
// out of microsites.go to keep that file under the max-lines cap.

package public

import "html"

// seoTitleTag / seoDescTag — the per-page SEO tags, or "" when unset. html.EscapeString guards
// against a `"`/`<` in the owner's copy breaking out of the tag.
func seoTitleTag(t *string) string {
	if t == nil || *t == "" {
		return ""
	}
	return "<title>" + html.EscapeString(*t) + "</title>"
}

func seoDescTag(d *string) string {
	if d == nil || *d == "" {
		return ""
	}
	return `<meta name="description" content="` + html.EscapeString(*d) + `">`
}
