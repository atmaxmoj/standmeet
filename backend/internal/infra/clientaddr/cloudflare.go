// cloudflare.go —— the visitor behind a Cloudflare edge, with nothing for a self-hoster to set.
//
// A proxy that does not trust Cloudflare (Traefik's default, so Coolify's) passes on the edge as
// the forwarded address; the visitor's own address is only in CF-Connecting-IP. The header is
// believed only when the hop is inside Cloudflare's published ranges: a request reaching the origin
// directly arrives from its own address, so it cannot name a different visitor.

package clientaddr

import (
	"net/http"
	"net/netip"
	"strings"
)

// cloudflareRanges —— https://www.cloudflare.com/ips-v4 and /ips-v6 (2026-10-11).
// ponytail: compiled in; Cloudflare rarely changes these, refresh from the URLs above if it does.
var cloudflareRanges = []netip.Prefix{
	netip.MustParsePrefix("173.245.48.0/20"), netip.MustParsePrefix("103.21.244.0/22"),
	netip.MustParsePrefix("103.22.200.0/22"), netip.MustParsePrefix("103.31.4.0/22"),
	netip.MustParsePrefix("141.101.64.0/18"), netip.MustParsePrefix("108.162.192.0/18"),
	netip.MustParsePrefix("190.93.240.0/20"), netip.MustParsePrefix("188.114.96.0/20"),
	netip.MustParsePrefix("197.234.240.0/22"), netip.MustParsePrefix("198.41.128.0/17"),
	netip.MustParsePrefix("162.158.0.0/15"), netip.MustParsePrefix("104.16.0.0/13"),
	netip.MustParsePrefix("104.24.0.0/14"), netip.MustParsePrefix("172.64.0.0/13"),
	netip.MustParsePrefix("131.0.72.0/22"),
	netip.MustParsePrefix("2400:cb00::/32"), netip.MustParsePrefix("2606:4700::/32"),
	netip.MustParsePrefix("2803:f800::/32"), netip.MustParsePrefix("2405:b500::/32"),
	netip.MustParsePrefix("2405:8100::/32"), netip.MustParsePrefix("2a06:98c0::/29"),
	netip.MustParsePrefix("2c0f:f248::/32"),
}

// visitorBehind —— the visitor for a request whose hop is `hop`. A non-Cloudflare hop is the
// visitor. A Cloudflare hop is not: its CF-Connecting-IP is, and without a valid one the visitor is
// unknown (empty), never the edge.
func visitorBehind(r *http.Request, hop string) string {
	addr, err := netip.ParseAddr(hop)
	if err != nil || !inCloudflare(addr.Unmap()) {
		return hop
	}
	v, err := netip.ParseAddr(strings.TrimSpace(r.Header.Get("Cf-Connecting-Ip")))
	if err != nil {
		return ""
	}
	return v.Unmap().String()
}

func inCloudflare(addr netip.Addr) bool {
	for _, p := range cloudflareRanges {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
