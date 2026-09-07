// detect.go —— what we can tell about a client from its headers.
//
// Ported in intent from umami's src/lib/detect.ts. Two deliberate differences:
//
//  1. No MaxMind database. Shipping a GeoLite2 .mmdb with a self-hosted binary means a licence
//     obligation and a 60MB asset that goes stale. We read the geo headers a reverse proxy
//     already sets, and leave the columns empty when there is no proxy. An empty country is
//     honest; a wrong one is not.
//     ponytail: header-only geolocation, no city resolution behind a bare Caddy. Wire
//     oschwald/geoip2-golang against an owner-supplied .mmdb path if an owner asks for it.
//
//  2. No dependency for bot detection. The list below is vendored from the isbot project's
//     pattern (MIT) rather than imported, because pulling a module into a self-hosted binary to
//     evaluate one pattern is a poor trade.
//     ponytail: the bot list is a frozen copy and goes stale. Re-sync it against
//     github.com/omrilotan/isbot when a release touches this file. A missed entry costs one
//     inflated view, not a broken instance.

package entity

import (
	"strconv"
	"strings"
)

// namedBots —— the crawlers whose identity is itself product information, checked before the
// generic pattern so the panel can name them.
//
// The link-preview fetchers are the reason this table exists. When a recruiter pastes a coded
// landing URL into Slack, Teams, WhatsApp or LinkedIn, that service fetches the URL to build a
// preview card. Umami would discard the hit. We record it and name it, because "your link was
// pasted into a group chat" is the earliest signal the job loop produces (traffic.md §4.3).
//
// The AI crawlers are here for the same reason at the other end: this product's thesis is that
// an AI answers in the owner's voice, so knowing that ClaudeBot read the corpus is part of the
// product, not infrastructure trivia.
var namedBots = []struct{ match, name string }{
	// link-preview fetchers
	{"slackbot", "Slack"},
	{"slack-imgproxy", "Slack"},
	{"discordbot", "Discord"},
	{"telegrambot", "Telegram"},
	{"whatsapp", "WhatsApp"},
	{"linkedinbot", "LinkedIn"},
	{"twitterbot", "Twitter"},
	{"facebookexternalhit", "Facebook"},
	{"skypeuripreview", "Skype"},
	{"redditbot", "Reddit"},
	// AI crawlers
	{"gptbot", "GPTBot"},
	{"oai-searchbot", "OpenAI"},
	{"chatgpt-user", "ChatGPT"},
	{"claudebot", "ClaudeBot"},
	{"claude-web", "ClaudeBot"},
	{"anthropic-ai", "Anthropic"},
	{"perplexitybot", "Perplexity"},
	{"google-extended", "Google-Extended"},
	{"bytespider", "ByteSpider"},
	{"ccbot", "CommonCrawl"},
	{"applebot", "Applebot"},
	// search engines
	{"googlebot", "Googlebot"},
	{"bingbot", "Bingbot"},
	{"duckduckbot", "DuckDuckBot"},
	{"yandexbot", "YandexBot"},
	{"baiduspider", "Baiduspider"},
	// monitoring and tooling
	{"uptimerobot", "UptimeRobot"},
	{"pingdom", "Pingdom"},
	{"headlesschrome", "HeadlessChrome"},
	{"playwright", "Playwright"},
	{"curl/", "curl"},
	{"wget/", "wget"},
	{"python-requests", "python-requests"},
	{"go-http-client", "Go"},
}

// genericBotMarkers —— the fallback for everything unnamed. Deliberately broad: an
// unrecognised crawler counted as a person inflates every number on the panel, while a person
// misfiled as a bot is one missing view in a panel that is still one click away.
var genericBotMarkers = []string{
	"bot", "crawl", "spider", "slurp", "scrape", "fetcher", "monitor",
	"preview", "archiver", "validator", "feed", "http-client", "libwww",
}

// DetectBot —— is this a bot, and if so which one. An empty name with a true flag never
// happens: an unrecognised bot is named "other" so the panel can still count it.
func DetectBot(userAgent string) (bool, string) {
	ua := strings.ToLower(userAgent)
	if ua == "" {
		// A request with no user agent is refused at the ingest boundary, so reaching here
		// with an empty one means a server emit for a surface that has no browser. Not a bot.
		return false, ""
	}
	if n := namedBot(ua); n != "" {
		return true, n
	}
	if looksLikeBot(ua) {
		return true, "other"
	}
	return false, ""
}

func namedBot(ua string) string {
	for _, b := range namedBots {
		if strings.Contains(ua, b.match) {
			return b.name
		}
	}
	return ""
}

func looksLikeBot(ua string) bool {
	for _, m := range genericBotMarkers {
		if strings.Contains(ua, m) {
			return true
		}
	}
	return false
}

var browsers = []struct{ match, name string }{
	// Order matters: every Chromium browser also says "chrome", and Chrome says "safari".
	{"edg/", "Edge"},
	{"opr/", "Opera"},
	{"brave", "Brave"},
	{"vivaldi", "Vivaldi"},
	{"samsungbrowser", "Samsung Internet"},
	{"firefox", "Firefox"},
	{"chrome", "Chrome"},
	{"safari", "Safari"},
}

var systems = []struct{ match, name string }{
	// iPadOS reports "macintosh" too, so the touch families come first.
	{"iphone", "iOS"},
	{"ipad", "iPadOS"},
	{"android", "Android"},
	{"windows", "Windows"},
	{"macintosh", "macOS"},
	{"mac os x", "macOS"},
	{"cros", "ChromeOS"},
	{"linux", "Linux"},
}

func matchTable(ua string, table []struct{ match, name string }) string {
	for _, e := range table {
		if strings.Contains(ua, e.match) {
			return e.name
		}
	}
	return ""
}

// DetectClient —— browser, OS and device from the user agent and the reported screen width.
//
// This is a table of substrings, not a parser. A user agent is a compatibility fiction and has
// been since 1994; a table that is right about the top ten browsers is worth more than a parser
// that is subtly wrong about all of them.
func DetectClient(userAgent, screen string) Client {
	ua := strings.ToLower(userAgent)
	c := Client{
		Browser: matchTable(ua, browsers),
		OS:      matchTable(ua, systems),
		Screen:  screen,
	}
	c.Device = deviceFor(ua, screen)
	c.IsBot, c.BotName = DetectBot(userAgent)
	return c
}

// laptopMaxWidth —— the screen width at or below which a non-touch client is called a laptop.
// Umami's number (src/lib/detect.ts:49-61).
const laptopMaxWidth = 1920

// deviceFor —— phone, tablet, laptop or desktop.
//
// The laptop rule is a guess, and it is a better guess than calling every non-phone a
// "desktop", which is a category the owner cannot act on.
func deviceFor(ua, screen string) string {
	if d := touchDevice(ua); d != "" {
		return d
	}
	if w := screenWidth(screen); w > 0 && w <= laptopMaxWidth {
		return "laptop"
	}
	return "desktop"
}

// touchDevice —— tablet or mobile, or empty when the user agent claims neither.
func touchDevice(ua string) string {
	if strings.Contains(ua, "ipad") || strings.Contains(ua, "tablet") {
		return "tablet"
	}
	for _, m := range []string{"mobi", "iphone", "android"} {
		if strings.Contains(ua, m) {
			return "mobile"
		}
	}
	return ""
}

// screenWidth —— the width out of a "1920x1080" string. Zero when it is missing or malformed,
// which sends deviceFor to "desktop" rather than guessing.
func screenWidth(screen string) int {
	w, _, found := strings.Cut(screen, "x")
	if !found {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(w))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// geoHeaderSets —— the country/region/city headers set by the reverse proxies a self-hosted
// instance is realistically behind. Tried in order; the first set with a country wins.
var geoHeaderSets = [][3]string{
	{"cf-ipcountry", "cf-region-code", "cf-ipcity"},
	{"x-vercel-ip-country", "x-vercel-ip-country-region", "x-vercel-ip-city"},
	{"cloudfront-viewer-country", "cloudfront-viewer-country-region", "cloudfront-viewer-city"},
	{"eo-ipcountry", "eo-region-code", "eo-ipcity"},
	{"x-geo-country", "x-geo-region", "x-geo-city"},
}

// HeaderLookup —— just enough of http.Header for this package to stay free of net/http.
type HeaderLookup func(name string) string

// DetectLocation —— country, region and city from proxy headers. All three stay empty behind a
// proxy that sets none, and that is the intended outcome: an empty country is honest, and a
// guessed one is not.
func DetectLocation(get HeaderLookup) Location {
	for _, set := range geoHeaderSets {
		c := strings.TrimSpace(get(set[0]))
		if c == "" {
			continue
		}
		return Location{
			Country: c,
			Region:  regionCode(c, strings.TrimSpace(get(set[1]))),
			City:    strings.TrimSpace(get(set[2])),
		}
	}
	return Location{}
}

// regionCode —— a region is only meaningful under its country, so it is stored qualified.
// Umami does the same; without it, "CA" is both California and Canada.
func regionCode(country, region string) string {
	if country == "" || region == "" {
		return ""
	}
	if strings.Contains(region, "-") {
		return region
	}
	return country + "-" + region
}
