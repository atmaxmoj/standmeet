// ssrf.go —— optional SSRF egress guard for outbound clients that fetch an owner-/user-supplied URL
// with NO allow-list (e.g. the writings inline image fetch). Blocks any dial whose target resolves
// to an internal/private address, pinning the validated IP into the dial so DNS can't be rebound to
// an internal host between check and connect (TOCTOU). Opt in via Options.BlockInternalEgress.
//
// NOTE: mirrors internal/connector/egress.go's guard (which additionally layers a hostname
// allow-list for owner-uploaded connector specs). The block-internal core is identical; a future
// pass could unify them here so there is a single SSRF implementation. Kept minimal + shared-home
// (httpx) so callers that can't import connector (arch: pluginownercore) still get the guard.

package httpx

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ErrBlockedEgress —— the dial target resolved to an internal/private address.
var ErrBlockedEgress = errors.New("egress target is an internal/private address (blocked)")

const internalDialTimeout = 10 * time.Second

// lookupIPAddr —— swappable resolver hook (tests inject a fake to exercise the rebind/pin logic).
var lookupIPAddr = net.DefaultResolver.LookupIPAddr

// egressAllowHosts —— hostnames explicitly permitted despite resolving to an internal address
// (EGRESS_ALLOW_HOSTS, comma-separated). EMPTY in prod (block everything internal); e2e/dev lists
// the mock service names (e.g. llm-gateway) so a BYOAI endpoint pointed at the in-cluster mock is
// allowed while real loopback/link-local targets stay blocked. Mirrors connector egress allow-list.
var egressAllowHosts = parseEgressAllow(os.Getenv("EGRESS_ALLOW_HOSTS"))

func parseEgressAllow(s string) map[string]bool {
	m := map[string]bool{}
	for h := range strings.SplitSeq(s, ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			m[h] = true
		}
	}
	return m
}

func isAllowedHost(host string) bool {
	return egressAllowHosts[strings.ToLower(host)]
}

// isInternalIP —— loopback / RFC1918 private / link-local / unspecified. (Same predicate as the
// connector egress guard.)
func isInternalIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// safeInternalDialAddr —— validate + return the address to actually dial. A literal internal IP is
// rejected; a hostname is resolved, every resolved IP checked, and a validated IP pinned into the
// returned addr (so the base dialer does not re-resolve → no rebind between check and connect).
func safeInternalDialAddr(ctx context.Context, addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("%w: bad dial addr %q: %w", ErrBlockedEgress, addr, err)
	}
	if isAllowedHost(host) {
		return addr, nil // explicitly permitted (e.g. e2e mock); dial as-is
	}
	if ip := net.ParseIP(host); ip != nil {
		if isInternalIP(ip) {
			return "", fmt.Errorf("%w: %s", ErrBlockedEgress, ip)
		}
		return addr, nil
	}
	return resolveAndPin(ctx, host, port)
}

// resolveAndPin —— resolve host, reject if ANY IP is internal (DNS-rebind defense), pin the first
// validated IP into a host:port dial addr.
func resolveAndPin(ctx context.Context, host, port string) (string, error) {
	ips, lerr := lookupIPAddr(ctx, host)
	if lerr != nil {
		return "", fmt.Errorf("%w: resolve %q: %w", ErrBlockedEgress, host, lerr)
	}
	if len(ips) == 0 {
		return "", fmt.Errorf("%w: %q resolved to no addresses", ErrBlockedEgress, host)
	}
	for _, a := range ips {
		if isInternalIP(a.IP) {
			return "", fmt.Errorf("%w: %q → internal %s", ErrBlockedEgress, host, a.IP)
		}
	}
	return net.JoinHostPort(ips[0].IP.String(), port), nil
}

// ValidatePublicURL —— returns ErrBlockedEgress if rawURL's host resolves to an internal/private
// address. Pre-flight validation for an untrusted (e.g. BYOAI) endpoint so callers can surface a
// clean, classified error BEFORE any dial. The dial-time guard (internalBlockingTransport) still
// covers DNS-rebind between this check and the connect; this is defense-in-depth + a good message.
func ValidatePublicURL(ctx context.Context, rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" {
		return fmt.Errorf("%w: bad url %q", ErrBlockedEgress, rawURL)
	}
	port := u.Port()
	if port == "" {
		port = "80"
		if u.Scheme == "https" {
			port = "443"
		}
	}
	_, derr := safeInternalDialAddr(ctx, net.JoinHostPort(u.Hostname(), port))
	return derr
}

// internalBlockingTransport —— an http.Transport whose DialContext refuses internal targets and
// pins the validated IP. Redirects re-dial through the same guard, so redirect-to-internal is also
// blocked.
func internalBlockingTransport() *http.Transport {
	base := &net.Dialer{Timeout: internalDialTimeout}
	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialAddr, derr := safeInternalDialAddr(ctx, addr)
			if derr != nil {
				return nil, derr
			}
			return base.DialContext(ctx, network, dialAddr)
		},
	}
}
