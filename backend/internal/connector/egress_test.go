package connector

import (
	"context"
	"errors"
	"net"
	"testing"
)

// withStubResolver — temporarily swap out lookupIPAddr, to test the pin/rebind logic
// (without sending real DNS).
func withStubResolver(ips []net.IPAddr, err error, fn func()) {
	orig := lookupIPAddr
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) { return ips, err }
	defer func() { lookupIPAddr = orig }()
	fn()
}

// TestSafeDialAddr_PinsValidatedIP — hostname resolves to a public IP → what gets
// dialed is **that IP**, not the host (this shuts out a rebind via re-resolution at
// dial time). This is the core assertion of the TOCTOU fix.
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

// TestSafeDialAddr_RebindInternalBlocked — resolves to an internal address
// (169.254.169.254, cloud metadata) → rejected.
func TestSafeDialAddr_RebindInternalBlocked(t *testing.T) {
	withStubResolver([]net.IPAddr{{IP: net.ParseIP("169.254.169.254")}}, nil, func() {
		_, err := EgressAllow{}.safeDialAddr(context.Background(), "rebind.example.com:80")
		if !errors.Is(err, ErrBlockedEgress) {
			t.Fatalf("internal-resolving host must be blocked, got %v", err)
		}
	})
}

// TestSafeDialAddr_LiteralIP — a literal public IP dials as-is; a literal internal IP
// is rejected.
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

// TestSafeDialAddr_Whitelist — a whitelisted host dials as-is (trusted, not
// resolved).
func TestSafeDialAddr_Whitelist(t *testing.T) {
	a := EgressAllow{"trusted.example.com": true}
	wl, werr := a.safeDialAddr(context.Background(), "trusted.example.com:443")
	if werr != nil || wl != "trusted.example.com:443" {
		t.Fatalf("whitelisted host: got %q err %v", wl, werr)
	}
}
