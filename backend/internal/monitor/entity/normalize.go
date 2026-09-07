// normalize.go —— turning a raw URL and referrer into the columns an aggregate can group by.
//
// Ported from umami (src/app/api/send/route.ts:196-307). Every rule here exists because the
// obvious version of it produces a broken leaderboard:
//
//   - The query string must be split off the path, or one page appears once per distinct query
//     and its true view count is never visible.
//   - `www.` must be stripped, or example.com and www.example.com are two referrers.
//   - A path-only referrer must resolve against the event's OWN domain. Resolving it against a
//     localhost fallback puts "localhost" at the top of a production referrer list.
//   - A self-referral must store no domain at all, or the instance is its own best referrer and
//     the panel says nothing.

package entity

import (
	"net/url"
	"strings"
)

// undefinedPath —— what a browser sends when the page URL was read before it existed. A client
// bug, not a page; umami maps it to empty for the same reason.
const undefinedPath = "/undefined"

// NormalizeURL —— the location half of an event.
//
// rawURL may be a full URL or a path. hostname is the host the visitor was actually on, which
// the browser reports separately because a path-only URL cannot carry it.
func NormalizeURL(rawURL, hostname string) Page {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u == nil {
		return Page{Hostname: hostDomain(hostname)}
	}
	if !u.IsAbs() {
		u = baseFor(hostname).ResolveReference(u)
	}
	q := u.Query()
	page := Page{
		Path:     cleanPath(u),
		Query:    u.RawQuery,
		Hostname: pickHostname(hostname, u),
		Src:      q.Get("src"),
	}
	fillUTM(&page, q)
	return page
}

// baseFor —— what a relative URL resolves against. `https://localhost` is the last resort, and
// it is why hostname is worth carrying: a relative URL resolved against localhost taints the
// hostname column of every event a client sends that way.
func baseFor(hostname string) *url.URL {
	if h := hostDomain(hostname); h != "" {
		if u, err := url.Parse("https://" + h); err == nil {
			return u
		}
	}
	u, err := url.Parse("https://localhost")
	if err != nil {
		return &url.URL{Scheme: "https", Host: "localhost"}
	}
	return u
}

// hostDomain —— a hostname with the scheme, port and a leading `www.` removed. One spelling per
// host, so a leaderboard never shows the same site twice.
func hostDomain(h string) string {
	h = strings.TrimSpace(strings.ToLower(h))
	if h == "" {
		return ""
	}
	if u, err := url.Parse("https://" + strings.TrimPrefix(h, "https://")); err == nil {
		h = u.Hostname()
	}
	return strings.TrimPrefix(h, "www.")
}

func pickHostname(reported string, u *url.URL) string {
	if h := hostDomain(reported); h != "" {
		return h
	}
	return hostDomain(u.Hostname())
}

// cleanPath —— the path, with the fragment appended when there is one. A single-page app that
// routes on the fragment would otherwise report every screen as `/`.
func cleanPath(u *url.URL) string {
	p := u.EscapedPath()
	if p == undefinedPath {
		return ""
	}
	if u.Fragment != "" {
		return p + "#" + u.Fragment
	}
	return p
}

func fillUTM(p *Page, q url.Values) {
	p.UTMSource = q.Get("utm_source")
	p.UTMMedium = q.Get("utm_medium")
	p.UTMCampaign = q.Get("utm_campaign")
	p.UTMContent = q.Get("utm_content")
	p.UTMTerm = q.Get("utm_term")
}

// ApplyReferrer —— fills a page's referrer columns.
//
// It takes the page rather than returning a value because the self-referral test needs the
// page's own hostname: without it every internal navigation is recorded as an external
// referral from the instance's own domain, and that domain then tops its own leaderboard.
func ApplyReferrer(p *Page, rawRef string) {
	u := parseReferrer(rawRef)
	if u == nil {
		return
	}
	p.RefPath = u.EscapedPath()
	// A path-only referrer came from this same site: keep the path, claim no domain.
	if !u.IsAbs() {
		return
	}
	if domain := hostDomain(u.Hostname()); domain != p.Hostname {
		p.RefDomain = domain
	}
}

// parseReferrer —— the referrer as a URL, or nil when there is nothing usable to record.
func parseReferrer(rawRef string) *url.URL {
	raw := strings.TrimSpace(rawRef)
	if raw == "" {
		return nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	return u
}
