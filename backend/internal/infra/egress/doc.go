// Package egress is the outbound SSRF guard for owner-supplied targets.
//
// The owner self-hosts and can upload any OpenAPI spec, so an outbound URL is attacker-influenced
// input by construction. This package hands back an HTTP client that refuses to dial an address
// resolving inside the private network, and pins the validated IP into the dial so DNS cannot be
// rebound between the check and the connect.
//
// It admits the host names the owner lists as internal hosts (/admin/system; the live list is held
// in infra/httpx, which the other outbound guard reads too).
package egress
