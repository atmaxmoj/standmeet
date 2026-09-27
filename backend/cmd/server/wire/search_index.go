// search_index.go — startup wiring for corpus lexical search (Meili): make sure the index
// exists with its settings. Filling it is not done here: StartBackground enqueues one
// corpus.reindex job at boot, and every later change arrives through the corpus.index
// subscriber.

package wire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
)

// SearchIndex — builds the Meili index settings. Best-effort: Meili being down or
// unconfigured never blocks startup (the reindex job retries until Meili answers).
func SearchIndex(ctx context.Context, d *deps.Runtime) {
	if d.SearchClient == nil {
		return
	}
	if err := d.SearchClient.EnsureIndex(ctx); err != nil {
		d.Log.Error("meili ensure index", "err", err)
	}
}
