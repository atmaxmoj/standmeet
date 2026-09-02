// search_index.go — startup wiring for corpus lexical search (Meili): build the index,
// backfill, background reconcile.
//
// This used to live in retrieval_socket.go (a file that only existed because of the
// retrieval plugin); once the inbound convergence point absorbed the socket wiring, these
// things had nothing to do with "who reads the corpus" and got their own address.

package wire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// SearchIndex — at boot, builds the Meili index (settings) + backfills the sole owner's
// corpus. Best-effort: Meili being down or unconfigured never blocks startup (D5: the
// backend still comes up if Meili is down at boot), failures only log — the write path +
// health-recovery reconcile will backfill the index.
func SearchIndex(ctx context.Context, d *deps.Runtime) {
	if d.SearchClient == nil {
		return
	}
	if err := d.SearchClient.EnsureIndex(ctx); err != nil {
		d.Log.Error("meili ensure index", "err", err)
		return
	}
	soleOwner, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.OwnerRepo})
	if err != nil {
		return // not claimed / not found -> nothing to backfill
	}
	if d.CorpusIndexer != nil {
		d.CorpusIndexer.ReindexOwner(ctx, soleOwner.ID)
	}
}

// The background reconcile loop no longer lives here: it's the corpus domain's own periodic
// job declaration (corpus.IndexPeriodicJobs), collected and started by wirePeriodicJobs —
// and it incidentally shows up in the Monitor background-jobs panel for the first time
// (the hand-written version never registered itself; it ran the whole time but was invisible).
