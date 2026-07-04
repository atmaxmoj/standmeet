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

	"github.com/atmaxmoj/standmeet/internal/httpx"
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
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialAddr, derr := a.safeDialAddr(ctx, addr)
			if derr != nil {
				return nil, derr
			}
			// 拨**验证过的 IP**,不让 base.DialContext 二次解析 host —— 杜绝 check→dial 之间
			// DNS 被 rebind 到内网(TOCTOU)。
			return base.DialContext(ctx, network, dialAddr)
		},
	}
	// 经 httpx 归一(统一 client + SSRF transport 组合)。NoRetry —— connector 层带幂等键
	// 自己管重试,transport 再重试会双重发。
	client := httpx.NewClient(httpx.Options{Base: transport, NoRetry: true})
	client.CheckRedirect = func(req *http.Request, _ []*http.Request) error {
		if a.staticBlocked(req.URL.Hostname()) {
			return fmt.Errorf("%w: redirect to %q", ErrBlockedEgress, req.URL.Hostname())
		}
		return nil
	}
	return client
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

// safeDialAddr —— 拨号前校验 + 返回**要真拨的地址**。主机名 → 解析、验所有 IP、把验过的一个 IP
// pin 进返回地址(host:port → validatedIP:port),底层 dialer 不再二次解析,杜绝 TOCTOU。
// 白名单 host / 字面公网 IP → 原样返回。
func (a EgressAllow) safeDialAddr(ctx context.Context, addr string) (string, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("%w: bad dial addr %q: %w", ErrBlockedEgress, addr, err)
	}
	if a[strings.ToLower(host)] {
		return addr, nil // 白名单 host,信任,原样拨
	}
	if a.staticBlocked(host) {
		return "", fmt.Errorf("%w: %q", ErrBlockedEgress, host)
	}
	return pinnedDialAddr(ctx, host, port, addr)
}

// pinnedDialAddr —— 字面公网 IP 原样返;主机名 → 解析验过后 pin 第一个安全 IP 进 addr。
func pinnedDialAddr(
	ctx context.Context, host, port, addr string,
) (string, error) {
	if net.ParseIP(host) != nil {
		return addr, nil // 字面公网 IP,无需解析
	}
	ip, rerr := resolveSafeIP(ctx, host)
	if rerr != nil {
		return "", rerr
	}
	return net.JoinHostPort(ip, port), nil
}

// lookupIPAddr —— 可替换的解析钩子(测试注入假 resolver 验 pin/rebind 逻辑)。
var lookupIPAddr = net.DefaultResolver.LookupIPAddr

// resolveSafeIP —— 解析主机名,任一 IP 落内网 → 拒(防 DNS rebinding / 解析到私网);全过 →
// 返回第一个 IP 作为拨号目标(pin)。
func resolveSafeIP(ctx context.Context, host string) (string, error) {
	ips, lerr := lookupIPAddr(ctx, host)
	if lerr != nil {
		return "", fmt.Errorf("%w: resolve %q: %w", ErrBlockedEgress, host, lerr)
	}
	if len(ips) == 0 {
		return "", fmt.Errorf("%w: %q resolved to no addresses", ErrBlockedEgress, host)
	}
	for i := range ips {
		ip := ips[i].IP
		if isInternalIP(ip) {
			return "", fmt.Errorf("%w: %q resolves to internal %s", ErrBlockedEgress, host, ip)
		}
	}
	return ips[0].IP.String(), nil
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
