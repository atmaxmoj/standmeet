package httpx

import (
	"context"
	"net"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestSafeInternalDialAddr_Blocks —— literal internal IPs and hostnames that RESOLVE to an internal
// IP (DNS-rebind) are refused with ErrBlockedEgress.
func TestSafeInternalDialAddr_Blocks(t *testing.T) {
	orig := lookupIPAddr
	t.Cleanup(func() { lookupIPAddr = orig })
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil // any host rebinds to loopback
	}
	for _, addr := range []string{
		"127.0.0.1:80", "10.0.0.5:443", "169.254.169.254:80", "0.0.0.0:80", "rebind.example:80",
	} {
		_, err := safeInternalDialAddr(context.Background(), addr)
		require.ErrorIsf(t, err, ErrBlockedEgress, "addr %q must be blocked", addr)
	}
}

// TestSafeInternalDialAddr_AllowsPublicAndPins —— a literal public IP passes through unchanged; a
// public hostname is pinned to its validated IP (so the base dialer can't re-resolve/rebind).
func TestSafeInternalDialAddr_AllowsPublicAndPins(t *testing.T) {
	orig := lookupIPAddr
	t.Cleanup(func() { lookupIPAddr = orig })
	lookupIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
	}
	literal, err := safeInternalDialAddr(context.Background(), "93.184.216.34:443")
	require.NoError(t, err)
	require.Equal(t, "93.184.216.34:443", literal)

	pinned, err := safeInternalDialAddr(context.Background(), "ok.example:443")
	require.NoError(t, err)
	require.Equal(t, "93.184.216.34:443", pinned, "hostname must be pinned to the resolved IP")
}
