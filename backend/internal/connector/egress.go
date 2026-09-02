// egress.go — the connector's outbound SSRF guard. The owner self-hosts and can upload any
// OpenAPI spec; if a spec's servers[].url / oauth token URL points at loopback / link-local /
// a private network, the backend becomes a pivot into the internal network (cloud metadata
// 169.254.169.254 / localhost / 10.x …). Two gates:
//  1. Static check at assembly time (CheckEgressURL): servers + token URL point internal →
//     refuse assembly (the connector is never built).
//  2. Runtime dialer guard (GuardedHTTPClient): DNS resolves, or a redirect lands, internal →
//     refuse the outbound call.
// The allow-list admits by hostname (the e2e external-mock is a private IP but explicitly
// allowed; prod leaves it empty and blocks everything).

package connector

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

// ErrBlockedEgress — the outbound target lands in the internal network (blocked by the SSRF
// guard). Used **only** for the judgment "this target is an internal address", because the
// owner-facing message is chosen based on it: getting this wrong sends someone off chasing a
// nonexistent internal-network problem.
var ErrBlockedEgress = errors.New("egress target is an internal/private address (blocked)")

// ErrEgressUnresolvable — the hostname can't be resolved / resolves to zero addresses. This is
// **not** "internal": a nonexistent domain and a domain that points internal are two different
// things, and they used to share ErrBlockedEgress, leaving the caller unable to tell them apart
// (F-C-23).
var ErrEgressUnresolvable = errors.New("egress target could not be resolved")

const egressDialTimeout = 10 * time.Second

// EgressAllow — an allow-list by hostname (bypasses the internal-network block). e2e injects
// external-mock; prod leaves it empty.
type EgressAllow map[string]bool

// NewEgressAllow — build an allow-list from a comma-separated hostname list.
func NewEgressAllow(hosts []string) EgressAllow {
	a := make(EgressAllow, len(hosts))
	for _, h := range hosts {
		if h = strings.TrimSpace(h); h != "" {
			a[strings.ToLower(h)] = true
		}
	}
	return a
}

// CheckEgressURL — static check at assembly time of one outbound URL (servers / token).
// Internal → ErrBlockedEgress. Empty URL is allowed (no outbound surface). A host that fails
// to parse is treated as invalid. No DNS lookup here (literal IPs + internal hostnames are
// enough to block at assembly time).
func (a EgressAllow) CheckEgressURL(rawURL string) error {
	if strings.TrimSpace(rawURL) == "" {
		return nil
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("%w: unparseable url %q", ErrBlockedEgress, rawURL)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("%w: url %q has no host", ErrBlockedEgress, rawURL)
	}
	if a.staticBlocked(host) {
		return fmt.Errorf("%w: %q", ErrBlockedEgress, host)
	}
	return nil
}

// GuardedHTTPClient — runtime outbound client: validates the resolved IP on every dial
// (allow-listed hosts are skipped), and refuses a redirect that jumps internal. This backstops
// what CheckEgressURL can't catch at assembly time — "DNS resolves internal" / "a runtime 302
// jumps internal". Every connector (built-in + uploaded) shares this, so it's uniform.
func (a EgressAllow) GuardedHTTPClient() *http.Client {
	base := &net.Dialer{Timeout: egressDialTimeout}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialAddr, derr := a.safeDialAddr(ctx, addr)
			if derr != nil {
				return nil, derr
			}
			// Dial the **validated IP**, don't let base.DialContext resolve the host a second
			// time — that would let DNS get rebound to internal between check and dial (TOCTOU).
			return base.DialContext(ctx, network, dialAddr)
		},
	}
	// Unified through httpx (the standard client + SSRF transport combo). NoRetry — the
	// connector layer manages its own retries with idempotency keys; a retrying transport
	// would double-send.
	client := httpx.NewClient(httpx.Options{Base: transport, NoRetry: true})
	client.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		if a.staticBlocked(req.URL.Hostname()) {
			return fmt.Errorf("%w: redirect to %q", ErrBlockedEgress, req.URL.Hostname())
		}
		return nil
	}
	return client
}

// staticBlocked — DNS-free block decision: allow-list first; a literal IP is checked against
// internal ranges; otherwise checked against internal hostnames.
func (a EgressAllow) staticBlocked(host string) bool {
	if a[strings.ToLower(host)] {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return isInternalIP(ip)
	}
	return blockedHostName(host)
}

// safeDialAddr — validate before dialing + return **the address to actually dial**. Hostname →
// resolve, validate every IP, pin one validated IP into the returned address
// (host:port → validatedIP:port), so the underlying dialer never resolves it a second time —
// no TOCTOU. Allow-listed host / literal public IP → returned unchanged.
func (a EgressAllow) safeDialAddr(ctx context.Context, addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("%w: bad dial addr %q: %w", ErrBlockedEgress, addr, err)
	}
	if a[strings.ToLower(host)] {
		return addr, nil // allow-listed host, trusted, dial as-is
	}
	if a.staticBlocked(host) {
		return "", fmt.Errorf("%w: %q", ErrBlockedEgress, host)
	}
	return pinnedDialAddr(ctx, host, port, addr)
}

// pinnedDialAddr — a literal public IP is returned unchanged; a hostname is resolved,
// validated, and the first safe IP is pinned into addr.
func pinnedDialAddr(
	ctx context.Context, host, port, addr string,
) (string, error) {
	if net.ParseIP(host) != nil {
		return addr, nil // literal public IP, no resolution needed
	}
	ip, rerr := resolveSafeIP(ctx, host)
	if rerr != nil {
		return "", rerr
	}
	return net.JoinHostPort(ip, port), nil
}

// lookupIPAddr — a replaceable resolution hook (tests inject a fake resolver to validate the
// pin/rebind logic).
var lookupIPAddr = net.DefaultResolver.LookupIPAddr

// resolveSafeIP — resolve the hostname; any IP landing internal → refuse (guards against DNS
// rebinding / resolving to a private network); if all pass → return the first IP as the dial
// target (pin).
func resolveSafeIP(ctx context.Context, host string) (string, error) {
	ips, lerr := lookupIPAddr(ctx, host)
	if lerr != nil {
		return "", fmt.Errorf("%w: resolve %q: %w", ErrEgressUnresolvable, host, lerr)
	}
	if len(ips) == 0 {
		return "", fmt.Errorf("%w: %q resolved to no addresses", ErrEgressUnresolvable, host)
	}
	for i := range ips {
		ip := ips[i].IP
		if isInternalIP(ip) {
			return "", fmt.Errorf("%w: %q resolves to internal %s", ErrBlockedEgress, host, ip)
		}
	}
	return ips[0].IP.String(), nil
}

// isInternalIP — loopback / private network (RFC1918+ULA) / link-local (includes
// 169.254.169.254) / unspecified → internal.
func isInternalIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// blockedHostName — internal hostnames that aren't IP literals (localhost / *.internal /
// *.local / metadata).
func blockedHostName(host string) bool {
	h := strings.ToLower(host)
	if h == "localhost" || h == "metadata.google.internal" {
		return true
	}
	return strings.HasSuffix(h, ".internal") || strings.HasSuffix(h, ".local")
}
