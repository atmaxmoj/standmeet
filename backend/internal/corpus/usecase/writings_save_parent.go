// writings_save_parent.go —— parent_id concerns for SaveWriting: validates the parent
// before persisting, and keeps parent from being wiped by the body-write half of a
// two-phase save. Split out of writings_save.go to stay under the max-lines guard.

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// validateWritingParent —— if parent_id is given, it must be a writing owned by this
// owner (the FK only guarantees the id exists, not the owner). Not found ->
// ErrParentNotFound; a write must never attach to an invalid parent and end up
// orphaned. Empty -> root. Same contract as wiki's validateWikiParent. Cycle checking
// (reparent) is left to admin reparent (#55).
func validateWritingParent(ctx context.Context, deps WritingsTxDeps, in *SaveWritingInput) error {
	if in.ParentID == "" {
		return nil
	}
	if _, err := deps.Writings.GetByID(ctx, in.OwnerID, in.ParentID); err != nil {
		if errors.Is(err, entity.ErrWritingNotFound) {
			return entity.ErrParentNotFound
		}
		return fmt.Errorf("validate writing parent: %w", err)
	}
	// reparent (an update changing the parent): guard against a cycle — a node must
	// not be attached under itself or one of its own descendants.
	if in.WritingID != "" {
		return checkNoWritingParentCycle(ctx, deps, in.OwnerID, in.WritingID, in.ParentID)
	}
	return nil
}

// checkNoWritingParentCycle —— walks up the parent chain from the proposed parent;
// hitting nodeID means a cycle. Same contract as wiki's checkNoParentCycle.
func checkNoWritingParentCycle(
	ctx context.Context, deps WritingsTxDeps, ownerID, nodeID, parentID string,
) error {
	cur := parentID
	for range TreeMaxDepth {
		if cur == nodeID {
			return entity.ErrParentCycle
		}
		wg, err := deps.Writings.GetByID(ctx, ownerID, cur)
		if err != nil {
			return fmt.Errorf("writing cycle check: %w", err)
		}
		pid, ok := wg.ParentID()
		if !ok {
			return nil
		}
		cur = pid
	}
	return nil
}

// effectiveWritingParent —— the body-write phase overwrites every field, including
// parent_id. If input explicitly gives one, use it (create / reparent); otherwise
// keep the parent already on the shell-create or existing row, so a plain edit
// doesn't wipe it (SaveWriting is a two-phase write; a.Writing already carries the
// shell's or existing row's parent).
func effectiveWritingParent(a *writeBodyArgs) string {
	if a.In.ParentID != "" {
		return a.In.ParentID
	}
	pid, _ := a.Writing.ParentID()
	return pid
}
