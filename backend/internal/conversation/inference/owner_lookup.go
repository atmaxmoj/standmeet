// owner_lookup.go —— the narrow contract the resolver uses to fetch an owner's key from
// postgres. resolver.go uses this contract to resolve the Provider; the contract is kept
// separate from the implementation, so the owner aggregate's interface shape and the
// provider-selection strategy each get their own file.

package inference

import "context"

// OwnerKeyView —— the minimal information the resolver needs from the owner repo.
// Endpoint / Model are required only for provider='custom' (a self-hosted OpenAI-compat
// server), or non-empty when the owner explicitly overrode the preset default; otherwise left
// empty, and the resolver falls back to the preset default.
//
// Key is **already-unsealed** plaintext, not ciphertext. §1.5: the inside only seals, never
// unseals — so this neither accepts ciphertext, nor accepts "something that can unseal it".
// Unsealing happens on the assembly side; the kernel receives a usable credential, not the key
// that opens one. (This used to be `KeyEnc []byte` plus an injected KeyDecrypter: that handed
// the ciphertext AND a universal unsealer to one piece of code that had no business holding
// either.)
type OwnerKeyView struct {
	Provider string // 'anthropic' / 'openai' / 'deepseek' / ... / 'custom'
	Endpoint string // openai-compat base URL; empty = use the preset default
	Model    string // default model; empty = use the preset default
	Key      string // plaintext API key; empty = the owner hasn't configured one
}

// OwnerLookup —— the narrow interface the resolver injects, avoiding an import of postgres.
//
// providerID —— **which** provider this session should use (the owner holds a whole book of
// them, not just one). Empty = use the default. Which one wins (code > role > default) is
// already resolved at the moment the session is sent, and frozen into the session — the kernel
// only ever knows "use this one", not whether it came from a code or a role, and doesn't even
// know that a "code" concept exists.
type OwnerLookup interface {
	LookupForResolver(
		ctx context.Context, ownerID, providerID string,
	) (OwnerKeyView, error)
}

// There used to be a `KeyDecrypter func(ownerID string, enc []byte) ([]byte, error)` here —
// the assembly root injected a cryptobox.Decrypt closure, and the kernel unsealed
// owners.ai_provider_key_enc itself. It's been removed: what the kernel holds should never be
// "something that can unseal", and KeyDecrypter was a universal key that worked for **any**
// owner. Unsealing now happens only on the assembly side (see cmd/server's
// ownerLookupAdapter); the kernel receives OwnerKeyView.Key — a usable credential.
//
// This invariant is watched over by infra/scripts/check-core-seals-only.sh.
