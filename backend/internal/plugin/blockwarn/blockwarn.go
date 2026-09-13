// Package blockwarn records persistent owner warnings raised by block lifecycle events, and
// surfaces them in admin. The design's first warning is data loss: uninstalling a block that held
// data drops its schema (everything-is-a-block.md rule 3), and the owner must find out that N
// records were permanently gone — not have it vanish silently. "The warning is a block too": the
// warning is ordinary data in the db block's storage, keyed by owner, not a bespoke table.
//
// It reuses the blockstore pattern (host-owned schema, no SQL migration): the store is provisioned
// at boot like any block's, and each warning is one record.
package blockwarn

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
)

// BlockID — the warnings' own blockstore schema (mcp_block_warnings). Host-owned; provisioned at
// boot.
const BlockID = "block-warnings"

// collection — the one collection: warnings, newest listed last (blockstore orders by created_at).
const collection = "warnings"

// Kind — a warning's category, so admin can style/route by it. Data loss is the first.
type Kind string

// KindDataLoss — a block that held data was uninstalled; its records were permanently dropped.
const KindDataLoss Kind = "data_loss"

// Warning — one owner-visible warning. Message is human-readable and complete on its own.
type Warning struct {
	Kind    Kind   `json:"kind"`
	BlockID string `json:"block_id"`
	Message string `json:"message"`
	At      string `json:"at"` // RFC3339, so the list is orderable and legible without a join
}

// Store — persistent owner warnings, over the db block's storage.
type Store struct {
	bs *blockstore.Store
}

// New — construct over the shared blockstore.
func New(bs *blockstore.Store) *Store { return &Store{bs: bs} }

// Raise — record one warning for an owner. Scoped by owner in the doc (multi-tenant-ready), the
// same way every other row carries owner_id.
func (s *Store) Raise(ctx context.Context, owner string, w Warning) error {
	if err := s.ensure(ctx); err != nil {
		return err
	}
	if w.At == "" {
		w.At = time.Now().UTC().Format(time.RFC3339)
	}
	doc, err := json.Marshal(struct {
		Warning

		Owner string `json:"owner"`
	}{Warning: w, Owner: owner})
	if err != nil {
		return fmt.Errorf("blockwarn marshal: %w", err)
	}
	if _, ierr := s.bs.Insert(ctx, blockstore.KindMCP, BlockID, collection, doc); ierr != nil {
		return fmt.Errorf("blockwarn raise: %w", ierr)
	}
	return nil
}

// List — an owner's warnings, oldest first (blockstore orders by created_at).
func (s *Store) List(ctx context.Context, owner string) ([]Warning, error) {
	if err := s.ensure(ctx); err != nil {
		return nil, err
	}
	filter, ferr := json.Marshal(map[string]string{"owner": owner})
	if ferr != nil {
		return nil, fmt.Errorf("blockwarn filter: %w", ferr)
	}
	docs, err := s.bs.Query(ctx, blockstore.KindMCP, BlockID, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("blockwarn list: %w", err)
	}
	return decodeWarnings(docs)
}

// decodeWarnings — unmarshal each stored doc into a Warning. Split from List so List stays under
// the branch cap.
func decodeWarnings(docs []json.RawMessage) ([]Warning, error) {
	out := make([]Warning, 0, len(docs))
	for _, d := range docs {
		var w Warning
		if uerr := json.Unmarshal(d, &w); uerr != nil {
			return nil, fmt.Errorf("blockwarn unmarshal: %w", uerr)
		}
		out = append(out, w)
	}
	return out, nil
}

// ensure — the warnings schema exists. Idempotent (CREATE ... IF NOT EXISTS); called before each
// op so the store is self-sufficient rather than depending on a one-time boot provision that a
// schema-drop (an owner reset, or a test's instance reset) would leave behind. Warnings are
// low-traffic (raised only on uninstall-with-data), so the extra guarded DDL is negligible.
func (s *Store) ensure(ctx context.Context) error {
	if err := s.bs.Provision(ctx, blockstore.KindMCP, BlockID); err != nil {
		return fmt.Errorf("blockwarn provision: %w", err)
	}
	return nil
}
