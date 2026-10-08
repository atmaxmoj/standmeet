package entity

import (
	"errors"
	"time"
)

// MicrositeTrashRetention —— how long a deleted microsite waits before the purge job removes it
// with its builds and store. The same three months as the corpus trash (owner, 2026-10-08).
const MicrositeTrashRetention = 90 * 24 * time.Hour

// TrashedMicrosite —— one page in the trash.
type TrashedMicrosite struct {
	DeletedAt time.Time
	ID        string
	Slug      string
	Title     string
}

// ErrMicrositeNotInTrash —— restore of a page the trash does not hold: never deleted, already
// restored, or purged.
var ErrMicrositeNotInTrash = errors.New("microsite is not in the trash")

// SlugTakenError —— restore of a page whose slug a live page took since it was deleted.
type SlugTakenError struct {
	Slug string
}

func (e *SlugTakenError) Error() string {
	return "a live page now uses /p/" + e.Slug + ": rename or delete it, then restore this one"
}
