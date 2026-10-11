// network.go —— a visitor's network at organisation grain: the /24 or /48 their address sits in and
// the autonomous system announcing it. The address itself goes in and is dropped here, like the
// viewer hash's: only the prefix and the AS are returned.

package entity

import "net/netip"

// Prefix lengths kept: a /24 is one block of 256 IPv4 addresses (a rack, a building, a small ISP
// pool); a /48 is the block an IPv6 site or organisation is assigned. Both name an organisation,
// neither names a household.
const (
	keepV4Bits = 24
	keepV6Bits = 48
)

// ASResolver —— looks up the autonomous system for an address. Nil is valid (no ASN database): the
// network then carries its prefix only.
type ASResolver interface {
	// AS —— the AS number and the organisation running it; 0 and "" on a miss.
	AS(ip string) (uint, string)
}

// NetworkOf —— the prefix and AS for an address; empty for one that does not parse.
func NetworkOf(ip string, as ASResolver) Network {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return Network{}
	}
	addr = addr.Unmap()
	bits := keepV6Bits
	if addr.Is4() {
		bits = keepV4Bits
	}
	prefix, err := addr.Prefix(bits)
	if err != nil {
		return Network{}
	}
	n := Network{Prefix: prefix.String()}
	if as != nil {
		n.ASN, n.ASOrg = as.AS(ip)
	}
	return n
}
