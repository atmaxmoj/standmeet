// visitor_cred.go —— the provider credential a visitor brings themselves (BYOAI).
//
// **The trust level is carried by the type, not by a field.** Every instance of this type
// comes from a visitor, so the `Cred` resolved from it is always Untrusted — the caller has no
// "forgot to mark it" option, because marking it isn't its call to make.
//
// This used to be `owner.AICredential`: a structure living in the owner domain, exported by the
// owner facade, that held **both the owner's own key and the visitor's key**. Two problems
// stacked together:
//
//   - the owner domain had **not a single internal consumer** for it — it lived there purely
//     to be handed out. And a facade is "the domain's contract with the outside world", so "a
//     container for a plaintext API key" became part of the owner domain's contract: anyone who
//     imports the owner facade gets it for free, and the compiler never asks why.
//   - both trust levels shared one type, distinguishable only after the fact via the
//     `Cred.Untrusted` boolean. A boolean's zero value is false, i.e. "trusted" — a new
//     construction path that forgets to set it fails in the direction of **letting it through**.
//
// Now: the owner's copy is this package's unexported `ownerCred` (resolved within the domain,
// used within the domain, never crossing any facade); the visitor's copy is this type. Each
// path's trust level is fixed at **its construction site**.

package inference

// VisitorCred —— the provider credential a visitor brings themselves under BYOAI mode
// (unpacked by the route layer from the X-Byoai-* header via an HKDF envelope). **Always
// untrusted**: Endpoint is visitor-controlled, so its outbound traffic must pass through the
// SSRF gate, with the address pre-validated.
//
// The plaintext key exists only for the lifetime of one request; the server never persists a
// visitor's key.
type VisitorCred struct {
	Provider string
	Key      string
	Model    string
	Endpoint string
}

// HasKey —— whether the visitor actually brought a key. No key → falls back to the owner's
// own configured provider.
func (c *VisitorCred) HasKey() bool {
	return c != nil && c.Key != ""
}

// ownerCred —— the provider credential the owner configured themselves, unsealed from the
// owners row's ciphertext. **Never exported**: it must never take a single step outside this
// package — the further a plaintext credential travels across domains, the more code gets to
// see it.
type ownerCred struct {
	Provider string
	Key      string
	Model    string
	Endpoint string
}
