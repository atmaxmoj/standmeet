// host_bridges_claim.go — single-winner claim on the eval side.
//
// The real host guarantees "only one caller ever gets a given key" with a
// primary-key conflict (see capstore/claim.go). This is the mini-host: one
// table + one lock inside a single process, and the semantics **must match** —
// a fake claim that only ever returns true would keep the guard for it green
// forever on this side, and what that guard protects is exactly "two callers
// racing for the same slot" (F-B-15, [[stand-in-is-politer-than-reality]]).

package agentcore

import (
	"context"
	"sync"
	"time"
)

// claimTable — the in-process claim table. key = collection + "\x00" + key.
var claimTable = struct { //nolint:gochecknoglobals // mini-host state, mirrors real host's table
	till map[string]time.Time
	mu   sync.Mutex
}{till: map[string]time.Time{}}

// Claim — returns true on success; returns false (not an error) if someone
// else already holds it and it hasn't expired.
func (storeBridge) Claim(
	_ context.Context, collection, key string, ttlSeconds int,
) (bool, error) {
	claimTable.mu.Lock()
	defer claimTable.mu.Unlock()
	k := collection + "\x00" + key
	if till, held := claimTable.till[k]; held && till.After(time.Now()) {
		return false, nil
	}
	claimTable.till[k] = time.Now().Add(claimTTL(ttlSeconds))
	return true, nil
}

// Release — releases the slot this caller holds.
func (storeBridge) Release(_ context.Context, collection, key string) error {
	claimTable.mu.Lock()
	defer claimTable.mu.Unlock()
	delete(claimTable.till, collection+"\x00"+key)
	return nil
}

func claimTTL(seconds int) time.Duration {
	if seconds <= 0 {
		return time.Minute
	}
	return time.Duration(seconds) * time.Second
}
