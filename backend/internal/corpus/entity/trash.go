package entity

import (
	"errors"
	"time"
)

// TrashRetention —— how long a deleted entry waits in the trash before the purge job drops it.
// Three months (owner's call, 2026-10-08): long enough to notice a wrong delete or a bad vault
// sync after a quarter's absence, and the same span the visitor-traffic retention keeps.
const TrashRetention = 90 * 24 * time.Hour

// ErrNotInTrash —— restore of an entry the trash does not hold: never deleted, already restored,
// or purged.
var ErrNotInTrash = errors.New("not in the trash")

// ParentTrashedError —— restore of an entry whose parent is in the trash too: restoring the child
// alone would leave it with no place in the tree.
type ParentTrashedError struct {
	ParentTitle string
}

func (e *ParentTrashedError) Error() string {
	return "its parent \"" + e.ParentTitle + "\" is in the trash too: restore the parent first"
}
