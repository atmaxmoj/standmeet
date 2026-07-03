// egress.go —— connector 出站 SSRF 守卫。owner 自托管、可上传任意 OpenAPI spec，spec 里的
// servers[].url / oauth token URL 若指向 loopback / link-local / 私网，后端就成了打内网的跳板
// （cloud metadata 169.254.169.254 / localhost / 10.x …）。两道闸：
//   1. 装配期静态校验（CheckEgressURL）：servers + token URL 指内网 → 拒装配（连接器不建）。
//   2. 运行期 dialer 守卫（GuardedHTTPClient）：DNS 解析/重定向跑到内网 → 拒绝出站。
// allow-list 按 hostname 放行（e2e 的 external-mock 是私网 IP，但显式放行，prod 留空全拦）。

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
)

// ErrBlockedEgress —— 出站目标落在内网（被 SSRF 守卫拦下）。
var ErrBlockedEgress = errors.New("egress target is an internal/private address (blocked)")

const egressDialTimeout = 10 * time.Second

// EgressAllow —— 按 hostname 放行的白名单（绕过内网拦截）。e2e 注入 external-mock；prod 留空。
type EgressAllow map[string]bool

// NewEgressAllow —— 从逗号分隔的 hostname 列表建白名单。
func NewEgressAllow(hosts []string) EgressAllow {
	a := make(EgressAllow, len(hosts))
	for _, h := range hosts {
		if h = strings.TrimSpace(h); h != "" {
			a[strings.ToLower(h)] = true
		}
	}
	return a
}

// CheckEgressURL —— 装配期静态校验一个出站 URL（servers / token）。内网 → ErrBlockedEgress。
// 空 URL 放行（无出站面）。解析不出 host 视作非法。不做 DNS（字面 IP + 内网主机名足够拦装配期）。
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

// GuardedHTTPClient —— 运行期出站客户端：每次拨号校验解析出的 IP（白名单 host 跳过），且
// 重定向跳到内网 → 拒。装配期 CheckEgressURL 拦不到的「DNS 解析到内网 / 运行时 302 跳内网」
// 在这里兜底。所有 connector（内置 + 上传）共用它，归一。
func (a EgressAllow) GuardedHTTPClient() *http.Client {
	base := &net.Dialer{Timeout: egressDialTimeout}
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				if derr := a.checkDial(ctx, addr); derr != nil {
					return nil, derr
				}
				return base.DialContext(ctx, network, addr)
			},
		},
		CheckRedirect: func(req *http.Request, _ []*http.Request) error {
			if a.staticBlocked(req.URL.Hostname()) {
				return fmt.Errorf("%w: redirect to %q", ErrBlockedEgress, req.URL.Hostname())
			}
			return nil
		},
	}
}

// staticBlocked —— 不做 DNS 的拦截判定：白名单优先；IP 字面量查内网段；否则查内网主机名。
func (a EgressAllow) staticBlocked(host string) bool {
	if a[strings.ToLower(host)] {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return isInternalIP(ip)
	}
	return blockedHostName(host)
}

// checkDial —— 拨号前校验：先 staticBlocked，主机名再解析所有 IP，任一内网 → 拒。
func (a EgressAllow) checkDial(ctx context.Context, addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	if a[strings.ToLower(host)] {
		return nil
	}
	if a.staticBlocked(host) {
		return fmt.Errorf("%w: %q", ErrBlockedEgress, host)
	}
	if net.ParseIP(host) != nil { // 字面 IP 且未被 staticBlocked → 公网，放行
		return nil
	}
	return checkResolved(ctx, host)
}

// checkResolved —— 解析主机名，任一 IP 落内网 → 拒（防 DNS rebinding / 解析到私网）。
func checkResolved(ctx context.Context, host string) error {
	ips, lerr := net.DefaultResolver.LookupIPAddr(ctx, host)
	if lerr != nil {
		return fmt.Errorf("%w: resolve %q: %w", ErrBlockedEgress, host, lerr)
	}
	for i := range ips {
		if isInternalIP(ips[i].IP) {
			return fmt.Errorf("%w: %q resolves to internal %s", ErrBlockedEgress, host, ips[i].IP)
		}
	}
	return nil
}

// isInternalIP —— loopback / 私网(RFC1918+ULA) / link-local(含 169.254.169.254) / 未指定 → 内网。
func isInternalIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// blockedHostName —— 不是 IP 字面量的内网主机名（localhost / *.internal / *.local / metadata）。
func blockedHostName(host string) bool {
	h := strings.ToLower(host)
	if h == "localhost" || h == "metadata.google.internal" {
		return true
	}
	return strings.HasSuffix(h, ".internal") || strings.HasSuffix(h, ".local")
}
