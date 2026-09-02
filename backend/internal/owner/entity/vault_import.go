// vault_import.go —— the fact of "the last vault import" (UX-62).
//
// It lives in entity rather than repo or usecase: the repository writes
// it, the usecase reads it, the route renders it into a sentence — all
// three layers must speak **the same word**
// ([[vocabulary-must-not-diverge]]).

package entity

import "time"

// VaultImportReceipt —— the receipt of the last import.
//
// **Never is a zero value of time, not a count of 0**: "never imported"
// and "imported but zero changes" are two different things, and treating
// them as the same statement is exactly the UX-62 defect — an instance
// holding 1028 notes and an empty instance looked identical on
// /admin/obsidian.
// Deleted —— how many entries this import pruned (F-L-62). It's **not the
// same kind of number** as the other three: new/updated/skipped are all
// reversible, pruning is not. In prod, one full import once pruned an
// entire 10-note subtree, and the receipt only reported the other three
// numbers — the one irreversible half had no number.
type VaultImportReceipt struct {
	At      time.Time
	New     int
	Updated int
	Skipped int
	Deleted int
}

// Never —— never imported.
func (r VaultImportReceipt) Never() bool { return r.At.IsZero() }
