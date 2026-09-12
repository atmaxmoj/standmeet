// dispatcher.go — turn "seam, verb, JSON" into a call on whichever block supplies
// that seam.
//
// This replaces the old `Slots` type, and the split is the point. Slots did two jobs:
// it RESOLVED a seam to a supplier, and it DISPATCHED a verb onto that supplier's
// typed methods. The first job is the substrate's now (`plugin.Resolver`) — resolution
// is by name, so a CalDAV block can replace a Google one without any consumer knowing.
// The second job is real work that has to live somewhere, and it lives here, beside
// the adapters whose methods it calls.
//
// What is gone is the typed accessor. Slots exposed `Calendar() contract.CalendarProxy`
// and `Mail() contract.MailProxy`, so adding a seam meant adding a method, a proxy
// interface and a slot adapter — the star topology, expressed as Go types. A
// Dispatcher holds a lookup function instead: seams are strings all the way down.

package adapters

import (
	"context"
	"log/slog"
)

// LookupSupplier — the active supplier for one owner's seam.
//
// Injected rather than owned: the substrate resolves seams from manifests, and this
// package must not grow a second registry to answer the same question differently.
// Returning (nil, nil) means the seam has no supplier for this owner, which is a
// different fact from an error and must stay distinguishable — "not connected" and
// "lookup broke" send the owner to different places.
type LookupSupplier func(ctx context.Context, ownerID, seam string) (Supplier, error)

// SupplierByID — one named block, whether or not the owner made it active.
//
// The second way to find a supplier, and the only one that answers the owner's
// question "does the binding I just uploaded work?". Activation is a separate decision
// the owner has not made yet at that point, so resolving through the seam would find
// the block they are already using and silently test the wrong thing.
type SupplierByID func(id string) (Supplier, bool)

// Dispatcher — the seam-to-supplier call path.
type Dispatcher struct {
	lookup LookupSupplier
	byID   SupplierByID
	log    *slog.Logger // where a background call failure goes; injected by SetLogger
}

// NewDispatcher — composition root injects the seam lookup.
func NewDispatcher(lookup LookupSupplier) *Dispatcher { return &Dispatcher{lookup: lookup} }

// SetSupplierByID — composition root injects by-id resolution (diag only).
//
// Separate from the constructor because every ordinary call goes through a seam: a
// by-id path that were as easy to reach as the seam path is an invitation to name a
// block at a call site, which is the coupling this whole change removes.
func (s *Dispatcher) SetSupplierByID(fn SupplierByID) { s.byID = fn }
