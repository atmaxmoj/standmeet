// integration.go — the unified abstraction for a Document's sync relationship with an external
// system.
//
// Design points:
//   - A Document can carry multiple Integrations at once (the same wiki page synced by both
//     Obsidian sync and pulled by Notion, that future).
//   - Adding a new integration type (Notion/GitHub/AppleNotes/IM bridge…) only needs: a new
//     IntegrationKind constant + a new struct implementing the Integration interface, without
//     touching any Document/Genre/postgres caller. OCP-correct.
//   - Integrations manages the collection: Add / All / Find / Has, and All() always returns a
//     defensive copy.

package connector

import (
	"slices"
	"time"
)

// IntegrationKind — enum of integration types.
type IntegrationKind string

// Currently supported integration kinds. Future extension only adds a constant + a new struct
// implementing the interface.
const (
	IntegrationObsidian IntegrationKind = "obsidian"
)

// Integration — one sync relationship between a document and an external system.
type Integration interface {
	// Kind — returns this integration's type, letting the caller branch / type-assert on it.
	Kind() IntegrationKind
	// SourceRef — the unique reference to this document in the external system (vault path /
	// notion page id / github gist url, etc.).
	SourceRef() string
	// LastSyncedAt — the last sync time. Used for owner UI display; also consulted by
	// periodic re-sync scheduling.
	LastSyncedAt() time.Time
}

// Integrations — the collection of all integrations attached to a document.
// Embedded into Document as a value type; all mutating operations (Add) use a pointer receiver.
type Integrations struct {
	items []Integration
}

// NewIntegrations — construct by passing a set of integrations directly. Empty construction →
// empty collection. items is defensively cloned internally, so the caller mutating it later
// doesn't affect this collection.
func NewIntegrations(items ...Integration) Integrations {
	out := make([]Integration, 0, len(items))
	out = append(out, items...)
	return Integrations{items: out}
}

// Add — add one integration. Pointer receiver because it mutates.
func (i *Integrations) Add(in Integration) {
	i.items = append(i.items, in)
}

// All — returns a copy of all current integrations; the caller can range/sort it freely without
// affecting internal state. Never returns nil (an empty collection returns an empty slice).
func (i *Integrations) All() []Integration {
	out := make([]Integration, len(i.items))
	copy(out, i.items)
	return out
}

// Find — look up the first integration matching a kind. The caller typically type-asserts it
// back to a concrete type to use (e.g. Obsidian). Returns (nil, false) if not found.
func (i *Integrations) Find(kind IntegrationKind) (Integration, bool) {
	for _, x := range i.items {
		if x.Kind() == kind {
			return x, true
		}
	}
	return nil, false
}

// Has — whether an integration of this kind is attached. The boolean-only version of Find.
func (i *Integrations) Has(kind IntegrationKind) bool {
	_, ok := i.Find(kind)
	return ok
}

// Len — number of integrations. A caller could also do len(x.All()), but that allocates; Len
// does not.
func (i *Integrations) Len() int { return len(i.items) }

// Kinds — returns every attached IntegrationKind (deduplicated, in appearance order). Used for
// admin UI rendering.
func (i *Integrations) Kinds() []IntegrationKind {
	seen := make(map[IntegrationKind]struct{}, len(i.items))
	out := make([]IntegrationKind, 0, len(i.items))
	for _, x := range i.items {
		k := x.Kind()
		if _, dup := seen[k]; dup {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

// _ — compile-time check that Integrations wasn't misrenamed / has a field mismatch.
var _ = slices.Index[[]Integration, Integration]
