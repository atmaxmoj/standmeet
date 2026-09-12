// per_block.go — the "this block's own stuff" handed to inbound convergence: its
// isolated storage and its config.
//
// Constructed on the block side, not on the convergence side: which namespace it's
// bound to is **the block's own knowledge** — convergence only gathers the ops
// handed up from everywhere and dispatches them.

package blockwire

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

// PerBlockDeps — a block's **own** storage and config.
//
// Storage is bound to this block's namespace at construction time (schema = mcp_<id>),
// so the sandbox side can never fill in someone else's table. Whether to provision is decided
// in exactly one place, needsStorage — see storage.go.
func PerBlockDeps(d *deps.Runtime, m *plugin.Manifest) *hostdesk.PerBlock {
	per := &hostdesk.PerBlock{}
	store := BlockStorageOf(d, m)
	if store == nil {
		return per
	}
	// The prefix is the OP NAME as declared in `blocks/<id>/manifest.yaml`. It matches
	// only because the declarations, the host's published names and the sandboxed
	// servers that call them were all renamed together — four places speaking one
	// word. Renaming the Go package alone once left this literal pointing at a name
	// nothing used any more: no manifest matched, per.Store stayed nil, StoreOps
	// published nothing, and the host panicked that calendar.book wanted an op "the
	// host does not publish" — an op whose implementation was sitting right there.
	if wantsAny(m, "blockstore.") {
		per.Store = boundBlockStore{store: store, kind: blockstore.KindMCP, id: m.ID}
	}
	if len(m.Config) > 0 {
		per.Config = boundBlockConfig{cfg: BlockConfigFor(store, m.ID), decl: m.Config}
	}
	return per
}
