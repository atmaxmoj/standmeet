// Package seamctx — per-owner seam resolution as coeffect context.
//
// This is the model in internal/plugin/effect/seam_as_coeffect_test.go turned into the small API
// the live path uses. A seam (calendar, mail, …) is a key in an owner's context Σ (effect.Table). A
// provider block provides its seam value for an owner (Provide); a consumer resolves the owner's
// active provider (Resolve) and calls it — that call IS the dispatch. A provider going away is the
// returned dispose: the key leaves Σ and the seam stops resolving, with nothing supervising it.
//
// It replaces adapters.Suppliers' byID map + SeamStore.ActiveSupplierID lookup + the Dispatcher's
// resolve step. Each owner has their own Table, so two owners resolve one seam name independently.
package seamctx

import (
	"fmt"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// Context — the instance's seam resolution across owners. The zero value is not usable; use New.
type Context struct {
	owners map[string]*effect.Table
	mu     sync.Mutex
}

// New — an empty seam context.
func New() *Context {
	return &Context{owners: map[string]*effect.Table{}}
}

// Provide — a provider block provides its seam value for one owner. One active provider per
// owner+seam: a second Provide at an occupied seam is refused (effect.Table refuses a second bind
// at a bound key). The returned dispose retires it (disconnect / revoked credential).
func (c *Context) Provide(ownerID, seam string, v any) (effect.Dispose, error) {
	dispose, err := c.tableFor(ownerID).Set(seam, v)
	if err != nil {
		return nil, fmt.Errorf("seamctx: provide %q for %q: %w", seam, ownerID, err)
	}
	return dispose, nil
}

// Resolve — the owner's active provider for a seam, or (nil, false) when none provides it. The
// caller type-asserts to the seam's contract (calendar/mail), exactly as a coeffect consumer does.
func (c *Context) Resolve(ownerID, seam string) (any, bool) {
	c.mu.Lock()
	t, ok := c.owners[ownerID]
	c.mu.Unlock()
	if !ok {
		return nil, false
	}
	v, err := t.Get(seam)
	if err != nil {
		return nil, false
	}
	return v, true
}

// tableFor — the owner's Σ, created on first use.
func (c *Context) tableFor(ownerID string) *effect.Table {
	c.mu.Lock()
	defer c.mu.Unlock()
	t, ok := c.owners[ownerID]
	if !ok {
		t = &effect.Table{}
		c.owners[ownerID] = t
	}
	return t
}
