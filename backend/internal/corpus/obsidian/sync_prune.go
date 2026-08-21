// sync_prune.go —— F-L-6: the step that makes "sync" MEAN sync.
//
// Reconcile alone is upsert-only, so a note deleted from the vault lived in the corpus forever:
// the corpus could only ever grow, and re-syncing could never clean a ghost. Sync has exactly one
// meaning — make the destination equal the source — so an authoritative sync removes what the
// source no longer has.
//
// This is the ONLY destructive path in the sync face, so it gets its own file: the guards below
// are the whole safety argument and they should be read together, not buried in reconcile.

package obsidian

import "context"

// SyncMode —— what the uploaded file set MEANS. The two modes have OPPOSITE delete semantics, and
// it cannot be inferred from the files, so the caller must declare it (F-L-6).
//
//   - Authoritative: this IS the whole vault. A note absent from the upload was deleted from the
//     vault, so it is pruned. The owner's directory-picker "import vault" is authoritative.
//   - !Authoritative (partial — the zero value): a subset, e.g. an incremental/connector feed.
//     Absence carries no information, so NOTHING is deleted; otherwise one partial push would wipe
//     the corpus. Defaulting to partial means a caller who never thought about this cannot destroy
//     data by omission.
type SyncMode struct{ Authoritative bool }

// pruneAbsent —— everything reconciled this run is recorded in st.idOf (corp tree) or reported in
// result.Kept (the writings importer, which claims its own rows down a separate path); a
// vault-imported note in NEITHER vanished from the vault, so it goes. Refs and children cascade
// (FK), so a deleted folder takes its subtree with it.
//
// **Every path that claims a row has to report it.** The writings importer did not, and the prune
// in the same request deleted the writing that same import had just created — on the real vault,
// `genre='writing'` sat at zero rows forever while every import printed `1 new · 1 deleted`
// (F-L-63).
//
// Three guards, each blocking a distinct way this could destroy real work:
//   - partial upload → never prune. Absence means nothing in a subset feed.
//   - EMPTY corp tree → never prune. An upload carrying no corpus notes is a mis-picked directory,
//     an all-writings vault, or a failed parse — NOT "the owner deleted their whole corpus".
//     Refusing to read that as delete-everything is the difference between a sync and a disaster.
//   - any reconcile error → never prune. An error means the keep-set is incomplete, and pruning
//     against an incomplete keep-set deletes notes that are still in the vault.
//
// There is deliberately NO web-edit exemption. The vault is the single live source, so sync means
// the destination equals the source — a web edit does not pin a note against its own vault. To keep
// web work, export it back to the vault first, then sync (F-L-6).
func pruneAbsent(
	ctx context.Context, deps *SyncDeps, st *syncState, mode SyncMode, result *ImportResult,
) {
	if !shouldPrune(mode, st, result) {
		return
	}
	keep := make([]string, 0, len(st.idOf)+len(result.Kept))
	for _, id := range st.idOf {
		keep = append(keep, id)
	}
	keep = append(keep, result.Kept...)
	n, err := deps.Notes.PruneAbsentVaultNotes(ctx, st.ownerID, keep)
	if err != nil {
		result.Errors = append(result.Errors, "prune absent notes: "+err.Error())
		return
	}
	result.Deleted += n
}

// shouldPrune —— all three safety guards in one predicate (see pruneAbsent's doc for each). Every
// condition must hold before anything is deleted.
func shouldPrune(mode SyncMode, st *syncState, result *ImportResult) bool {
	return mode.Authoritative && len(st.idOf) > 0 && len(result.Errors) == 0
}
