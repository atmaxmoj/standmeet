// Package seamctx — per-owner seam resolution as coeffect context.
//
// A seam (its name is a string — "calendar", "mail", … — never a Go type) is a key in an owner's
// context Σ (effect.Table). A provider block provides itself for an owner at that key (Provide); a
// consumer resolves the owner's active provider (Resolve) and invokes a verb on it by name — that
// call IS the dispatch. A provider going away is the returned dispose: the key leaves the context
// and the seam stops resolving, with nothing supervising it.
//
// The substrate here knows ONLY strings and JSON: a seam name, a verb name, and json.RawMessage in
// and out. There is no CalendarProxy / MailProxy / "calendar" type anywhere — a provider is a
// Provider (CallVerb), which is exactly the shape of a block's tool-call. That is the whole point:
// this replaces adapters.Suppliers' byID map + SeamStore.ActiveSupplierID + the typed Dispatcher
// without reintroducing a concrete per-seam surface.
package seamctx

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/atmaxmoj/standmeet/internal/plugin/effect"
)

// Provider — what a block that provides a seam answers: run one verb by name with JSON args. The
// same shape as an MCP tool-call, so a sandboxed block (caldav) and an in-host one (an openapi
// binding, smtp) are the same to the substrate — it never learns which, nor what "calendar" means.
type Provider interface {
	CallVerb(
		ctx context.Context, ownerID, verb string, args json.RawMessage,
	) (json.RawMessage, error)
}

// Context — the instance's seam resolution across owners. The zero value is not usable; use New.
type Context struct {
	owners map[string]*effect.Table
	mu     sync.Mutex
}

// New — an empty seam context.
func New() *Context {
	return &Context{owners: map[string]*effect.Table{}}
}

// Provide — a provider block provides itself for one owner's seam. One active provider per
// owner+seam: a second Provide at an occupied seam is refused (effect.Table refuses a second bind
// at a bound key). The returned dispose retires it (disconnect / revoked credential).
func (c *Context) Provide(ownerID, seam string, p Provider) (effect.Dispose, error) {
	dispose, err := c.tableFor(ownerID).Set(seam, p)
	if err != nil {
		return nil, fmt.Errorf("seamctx: provide %q for %q: %w", seam, ownerID, err)
	}
	return dispose, nil
}

// Resolve — the owner's active provider for a seam, or (nil, false) when none provides it. The
// caller invokes a verb on it by name; it never learns the concrete provider or the seam's meaning.
func (c *Context) Resolve(ownerID, seam string) (Provider, bool) { //nolint:ireturn // element iface
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
	p, ok := v.(Provider)
	return p, ok
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
