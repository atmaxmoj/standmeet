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
	"time"
)

// ErrBlockedEgress —— the dial target resolved to an internal/private address.
var ErrBlockedEgress = errors.New("egress target is an internal/private address (blocked)")

const internalDialTimeout = 10 * time.Second

// lookupIPAddr —— swappable resolver hook (tests inject a fake to exercise the rebind/pin logic).
var lookupIPAddr = net.DefaultResolver.LookupIPAddr

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
