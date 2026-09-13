// issuer.go — mints and resolves native keys.
//
// The backend mints a native key at mount, bound to a fiber identity, and hands it to that fiber
// over its own confined channel. The reach-back auth boundary resolves a presented key back to
// the owning fiber. Two properties the design (everything-is-a-block.md rule 4) rests on hold BY
// CONSTRUCTION here, not by a runtime check:
//
//   - Self-only. There is no get-by-id: nothing maps a fiber id back to its key. A fiber holds
//     only the key it was handed and cannot name another's. The map is keyed by the SECRET key,
//     so knowing a fiber id gives no way to find its key.
//   - Unforgeable. A key is 32 bytes of crypto/rand carrying no fiber id, so it cannot be derived
//     or guessed — it resolves only because the issuer minted it and remembers it.
//
// The issuer is the per-mount access layer over durable ownership: mint on mount, Revoke on
// unmount. What survives a remount (the fiber-identity → schema-ownership binding) lives
// elsewhere, durably; the key itself may be short-lived.

package nativekey

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"sync"
)

// keyBytes — 32 bytes = 256 bits of entropy, enough that a key cannot be guessed or collided.
const keyBytes = 32

// Issuer — the live table of minted keys. Safe for concurrent use: mount/unmount and reach-back
// auth happen on different goroutines, so Issue / Resolve / Revoke are all guarded.
type Issuer struct {
	owner map[Key]string // key → the fiber id it was minted for
	mu    sync.RWMutex
}

// NewIssuer — an empty issuer.
func NewIssuer() *Issuer { return &Issuer{owner: map[Key]string{}} }

// Issue — mint a fresh key bound to fiberID. Every call returns a distinct key (random), so
// re-minting for the same fiber does not reuse or expose a prior key.
func (i *Issuer) Issue(fiberID string) (Key, error) {
	b := make([]byte, keyBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("nativekey: mint: %w", err)
	}
	k := Key(base64.RawURLEncoding.EncodeToString(b))
	i.mu.Lock()
	i.owner[k] = fiberID
	i.mu.Unlock()
	return k, nil
}

// Resolve — the reach-back auth boundary: which fiber owns this presented key. Returns
// ("", false) for a key this issuer did not mint (or one already revoked) — a forged or stale
// key has no path to succeed.
func (i *Issuer) Resolve(k Key) (string, bool) {
	i.mu.RLock()
	fiberID, ok := i.owner[k]
	i.mu.RUnlock()
	return fiberID, ok
}

// Revoke — retire a key (fiber unmounted). Idempotent: revoking an unknown key is a no-op.
func (i *Issuer) Revoke(k Key) {
	i.mu.Lock()
	delete(i.owner, k)
	i.mu.Unlock()
}
