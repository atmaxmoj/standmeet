package connector

import (
	"context"
	"errors"
	"net"
	"testing"
)

// withStubResolver —— 临时替换 lookupIPAddr,验 pin/rebind 逻辑(不发真 DNS)。
func withStubResolver(ips []net.IPAddr, err error, fn func()) {
	orig := lookupIPAddr
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) { return ips, err }
	defer func() { lookupIPAddr = orig }()
	fn()
}

// TestSafeDialAddr_PinsValidatedIP —— 主机名解析到公网 IP → 拨的是**那个 IP**,不是 host
// (杜绝 dial 时二次解析被 rebind)。这是 TOCTOU 修复的核心断言。
func TestSafeDialAddr_PinsValidatedIP(t *testing.T) {
	withStubResolver([]net.IPAddr{{IP: net.ParseIP("1.2.3.4")}}, nil, func() {
		got, err := EgressAllow{}.safeDialAddr(context.Background(), "evil.example.com:443")
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got != "1.2.3.4:443" {
			t.Fatalf("dial not pinned to validated IP: got %q, want 1.2.3.4:443", got)
		}
	})
}

// TestSafeDialAddr_RebindInternalBlocked —— 解析到内网(169.254.169.254 云元数据)→ 拒。
func TestSafeDialAddr_RebindInternalBlocked(t *testing.T) {
	withStubResolver([]net.IPAddr{{IP: net.ParseIP("169.254.169.254")}}, nil, func() {
		_, err := EgressAllow{}.safeDialAddr(context.Background(), "rebind.example.com:80")
		if !errors.Is(err, ErrBlockedEgress) {
			t.Fatalf("internal-resolving host must be blocked, got %v", err)
		}
	})
}

// TestSafeDialAddr_LiteralIP —— 字面公网 IP 原样拨;字面内网 IP 拒。
func TestSafeDialAddr_LiteralIP(t *testing.T) {
	got, err := EgressAllow{}.safeDialAddr(context.Background(), "8.8.8.8:443")
	if err != nil || got != "8.8.8.8:443" {
		t.Fatalf("literal public IP: got %q err %v", got, err)
	}
	_, blocked := EgressAllow{}.safeDialAddr(context.Background(), "127.0.0.1:80")
	if !errors.Is(blocked, ErrBlockedEgress) {
		t.Fatalf("literal internal IP must be blocked, got %v", blocked)
	}
}

// TestSafeDialAddr_Whitelist —— 白名单 host 原样拨(信任,不解析)。
func TestSafeDialAddr_Whitelist(t *testing.T) {
	a := EgressAllow{"trusted.example.com": true}
	wl, werr := a.safeDialAddr(context.Background(), "trusted.example.com:443")
	if werr != nil || wl != "trusted.example.com:443" {
		t.Fatalf("whitelisted host: got %q err %v", wl, werr)
	}
}
