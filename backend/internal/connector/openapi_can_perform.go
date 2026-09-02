// openapi_can_perform.go — "can this owner's grant perform this one operation".
//
// Why this is a separate question (F-B-8 ⭐⭐): `Connected` says **we're holding a usable
// connection**, and that's not the same as **this connection can do what you're asking it to
// do**. When an owner has only granted `calendar.readonly`, the connection is good, reads work,
// listing free/busy works, **only writes are permanently 403** — while the product still puts
// "book a meeting" in front of the visitor and tells them "try again in a bit" (a sentence that
// will never come true).
//
// Both sides are now data: **what's needed** lives in the spec's per-op `security`, **what was
// granted** lives on the connection row. Neither side gets copied into Go — copying it in would
// create a second source of truth, and it would eventually drift from the spec.

package connector

import (
	"context"
	"fmt"
)

// CanPerform — the spec declares no scope for this op → true (this step needs no extra
// permission).
func (c *openapiCore) CanPerform(ctx context.Context, ownerID, operationID string) (bool, error) {
	need := c.runtime.ScopesFor(operationID)
	if len(need) == 0 {
		return true, nil
	}
	conn, err := c.store.Get(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q can-perform %q: %w", c.id, operationID, err)
	}
	return grantCovers(conn.Scopes, need), nil
}

// grantCovers — granted ⊇ needed.
func grantCovers(granted, need []string) bool {
	have := make(map[string]bool, len(granted))
	for _, g := range granted {
		have[g] = true
	}
	for _, n := range need {
		if !have[n] {
			return false
		}
	}
	return true
}
