package entity_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/monitor/entity"
)

func TestNetworkOf(t *testing.T) {
	t.Parallel()
	for ip, want := range map[string]string{
		"203.0.113.57":           "203.0.113.0/24",
		"::ffff:203.0.113.57":    "203.0.113.0/24",
		"2001:4860:4860::8888":   "2001:4860:4860::/48",
		"2001:db8:85a3:12::7334": "2001:db8:85a3::/48",
		"not an ip":              "",
	} {
		if got := entity.NetworkOf(ip, nil).Prefix; got != want {
			t.Errorf("NetworkOf(%q) = %q, want %q", ip, got, want)
		}
	}
}
