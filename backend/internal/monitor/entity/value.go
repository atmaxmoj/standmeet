// value.go —— the normalised facts about one hit: where it happened, where it came from, and
// what the client was. Produced by NormalizeURL / NormalizeReferrer / DetectClient, never
// filled in by hand, so every caller gets the same self-referral, `www.` and bot rules.

package entity

// Page —— the location half of an event.
//
// Path and Query are separate on purpose: keeping the query on the path makes one page appear
// once per distinct query string, and its true view count is then never visible anywhere.
type Page struct {
	Path        string
	Query       string
	Hostname    string
	Title       string
	UTMSource   string
	UTMMedium   string
	UTMCampaign string
	UTMContent  string
	UTMTerm     string
	Src         string
	// RefDomain / RefPath —— the source half. Empty RefDomain means the referrer was this same
	// site, which is what keeps the instance off the top of its own referrer leaderboard.
	RefDomain string
	RefPath   string
}

// Client —— what we could work out about the visitor's device.
//
// Every field may be empty and none is ever required for an event to be recorded: a missing
// country is a fact about the deployment (no proxy sets a geo header), not a broken event.
type Client struct {
	Browser  string
	OS       string
	Device   string
	Screen   string
	Language string
	Country  string
	Region   string
	City     string
	BotName  string
	// Network —— where on the internet the visitor sat, at organisation grain (never the address).
	Network Network
	IsBot   bool
}

// Network —— the /24 (IPv4) or /48 (IPv6) the visitor's address sits in, and the autonomous system
// announcing it. Organisation grain on purpose: it tells "a data centre in Singapore, Alibaba" from
// "a home connection", and it cannot point at one household (owner, 2026-10-11).
type Network struct {
	Prefix string
	ASOrg  string
	ASN    uint
}

// Location —— country, region and city, as reported by a reverse proxy. Returned as one value
// so callers cannot pick up two of the three and silently drop the qualifier off the region.
type Location struct {
	Country string
	Region  string
	City    string
}
