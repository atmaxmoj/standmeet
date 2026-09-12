// suppliers.go — the assembled suppliers this instance has, and how a seam name finds
// one.
//
// This is what is left of the old Hub + Slots pair, and what is left is
// deliberately small. Hub was a registry type with its own package; Slots sat on top of
// it and exposed one typed accessor per seam — `Calendar() contract.CalendarProxy`,
// `Mail() contract.MailProxy` — so a new seam cost a proxy interface, an accessor, a
// slot adapter and a switch case. That was the star topology written in Go types.
//
// What actually has to exist is two facts: the instances that were assembled at boot,
// and which one the owner made active for a seam. The first is a map. The second is a
// question for the store the owner's choice was written to. Neither needs a type of its
// own, and nothing here knows the word "calendar".

package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

// SeamStore — which supplier the owner made active for a seam.
//
// Narrowed to the one question: the owner's choice is a persisted fact and this package
// is not its owner. Returning an empty id means "the owner has not chosen", which is a
// different answer from an error and must stay distinguishable — one sends the owner to
// the panel, the other to the logs.
type SeamStore interface {
	ActiveSupplierID(ctx context.Context, ownerID, seam string) (string, error)
}

// Suppliers — assembled blocks by id, plus the store that says which is active.
//
// Field order follows pointer width — enforced by govet fieldalignment.
type Suppliers struct {
	byID  map[string]Supplier
	store SeamStore
	mu    sync.RWMutex
}

// NewSuppliers — empty, with the owner's active-choice store injected.
func NewSuppliers(store SeamStore) *Suppliers {
	return &Suppliers{byID: map[string]Supplier{}, store: store}
}

// Put — add or replace one assembled supplier. Idempotent by id.
func (s *Suppliers) Put(sup Supplier) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byID[sup.Name()] = sup
}

// ByID — one assembled supplier, if this instance has it.
func (s *Suppliers) ByID(id string) (Supplier, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sup, ok := s.byID[id]
	return sup, ok
}

// ErrNotInstalled — no block on this instance goes by that id.
var ErrNotInstalled = errors.New("no such block on this instance")

// VerifySupplier — run one block's connection test, if it has one.
//
// A block that does not implement Verifier passes: for an oauth or api-key supplier,
// saving the credential is what makes it usable, and there is nothing to dial. Only a
// protocol supplier has a handshake worth running, and it says so by implementing the
// interface rather than by a flag someone has to remember to set.
func (s *Suppliers) VerifySupplier(ctx context.Context, blockID, ownerID string) error {
	sup, ok := s.ByID(blockID)
	if !ok {
		return fmt.Errorf("verify block %q: %w", blockID, ErrNotInstalled)
	}
	v, isVerifier := sup.(Verifier)
	if !isVerifier {
		return nil
	}
	if err := v.Verify(ctx, ownerID); err != nil {
		return fmt.Errorf("verify block %q: %w", blockID, err)
	}
	return nil
}

// AgentToolSuppliersByID — the named blocks that actually expose agent tools.
//
// Two filters, and both matter: a block this instance does not have is skipped, and so
// is one that has agent tools switched off. The caller passes ids of blocks the owner
// has CONNECTED, so what comes back is connected ∩ installed ∩ opted-in — an
// unconnected block never reaches a visitor's toolset by this path.
func (s *Suppliers) AgentToolSuppliersByID(ids []string) []AgentToolSupplier {
	out := make([]AgentToolSupplier, 0, len(ids))
	for _, id := range ids {
		sup, ok := s.ByID(id)
		if !ok {
			continue
		}
		if atc, isAgent := sup.(AgentToolSupplier); isAgent && atc.ExposesAgentTools() {
			out = append(out, atc)
		}
	}
	return out
}

// AgentCall — run one agent op on a named block, injecting the owner's auth.
//
// By id, not by seam: the owner has just uploaded a binding and wants THAT block
// exercised on its own merits, with no interference from which one is active. A block
// this instance does not have, or one that offers no agent tools, is the same answer —
// there is nothing at that address — which the caller turns into a 404.
func (s *Suppliers) AgentCall(
	ctx context.Context, id, ownerID, opID string, args json.RawMessage,
) (json.RawMessage, error) {
	sup, ok := s.ByID(id)
	if !ok {
		return nil, fmt.Errorf("agent call %q: %w", id, ErrNotInstalled)
	}
	atc, isAgent := sup.(AgentToolSupplier)
	if !isAgent {
		return nil, fmt.Errorf("agent call %q: %w", id, ErrNotInstalled)
	}
	raw, err := atc.CallAgentOp(ctx, ownerID, opID, args)
	if err != nil {
		return nil, fmt.Errorf("agent call %q: %w", id, err)
	}
	return raw, nil
}

// AgentOpView — one authorizable operation, as the owner's panel sees it.
//
// A view rather than the thing itself: the composition root asks "what could this block
// be authorised to do" and gets names and descriptions, never a handle it could call
// with. That separation is why the owner-facing grant screen never needed credentials.
type AgentOpView struct {
	Name        string
	Description string
}

// AgentOpsByID — the operations each named block exposes, for the ones that expose any.
//
// A block that is not installed, or does not offer agent tools, is simply absent from
// the result — not present with an empty list. The caller is building a grant screen,
// and "this block has nothing to authorise" and "this block is not here" send the owner
// to different places.
func (s *Suppliers) AgentOpsByID(ids []string) map[string][]AgentOpView {
	out := make(map[string][]AgentOpView, len(ids))
	for _, id := range ids {
		sup, ok := s.ByID(id)
		if !ok {
			continue
		}
		atc, isAgent := sup.(AgentToolSupplier)
		if !isAgent || !atc.ExposesAgentTools() {
			continue
		}
		out[id] = toAgentOpViews(atc.AgentOps())
	}
	return out
}

func toAgentOpViews(ops []AgentOp) []AgentOpView {
	out := make([]AgentOpView, 0, len(ops))
	for i := range ops {
		out = append(out, AgentOpView{Name: ops[i].Name, Description: ops[i].Description})
	}
	return out
}

// Lookup — the LookupSupplier the dispatcher is built with.
//
// (nil, nil) when the owner has chosen nothing, or chose something this instance no
// longer has. Both are "no supplier for this seam" from the caller's side, and neither
// is an error: a block the owner removed is not a fault, it is a decision.
func (s *Suppliers) Lookup(
	ctx context.Context, ownerID, seam string,
) (Supplier, error) {
	if s == nil || s.store == nil {
		return nil, nil
	}
	id, err := s.store.ActiveSupplierID(ctx, ownerID, seam)
	if err != nil {
		return nil, fmt.Errorf("active supplier for seam %q: %w", seam, err)
	}
	return s.chosen(id), nil
}

// chosen — the supplier the owner named, if this instance still has it.
//
// An empty id ("chose nothing") and an id this build no longer ships both come back nil: from
// the caller's side they are the same fact, "no supplier for this seam", and neither is an
// error. A block the owner removed is not a fault, it is a decision.
func (s *Suppliers) chosen(id string) Supplier {
	if id == "" {
		return nil
	}
	sup, ok := s.ByID(id)
	if !ok {
		return nil
	}
	return sup
}
