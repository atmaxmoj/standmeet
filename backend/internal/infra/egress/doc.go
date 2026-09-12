// Package egress is the outbound SSRF guard for owner-supplied targets.
//
// The owner self-hosts and can upload any OpenAPI spec, so an outbound URL is attacker-influenced
// input by construction. This package hands back an HTTP client that refuses to dial an address
// resolving inside the private network, and pins the validated IP into the dial so DNS cannot be
// rebound between the check and the connect.
//
// It also carries the owner's hostname allow-list (SUPPLIER_EGRESS_ALLOW), which is the half that
// distinguishes it from the guard in infra/httpx: that one is for a URL nobody declared in
// advance, this one for a supplier whose reachable hosts the owner stated up front.
package egress
