// storage.go — a block's **own** storage and config, bound to its own namespace.
//
// The binding happens at construction time: the interface carries no kind / id, so the sandbox
// side has no path at all to "fill in someone else's table" — isolation is built in by
// construction, not validated per request. The schema name is derived from **an id the host
// trusts** (mcp_<id>), never taken from the plugin's request.

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockconfig"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/blockdesk"
)

// BlockStorageInit — at startup, provisions one schema (mcp_<id>) for every block
// that **needs** storage; every wiring point pulls from here afterward.
//
// Once, not once per wiring point: provision is DDL, so running it repeatedly is both slow and
// scatters the fact "does this block have storage" into a separate check at each site.
func BlockStorageInit(ctx context.Context, d *deps.Runtime) {
	manifests := BuiltinManifests()
	for i := range manifests {
		ProvisionBlockStorage(ctx, d, &manifests[i])
	}
}

// ProvisionBlockStorage — give one block its schema, if it wants one.
//
// Split out of the startup loop because a block can arrive AFTER startup now: the owner
// pastes a manifest and it mounts immediately. Without this on the install path, a block
// that declares `config` lists fine, renders its form fine, and fails the moment the
// form is read — `relation "mcp_<id>_blockconfig" does not exist` — which reads to the
// owner as the panel being broken rather than the block never having been given a home.
//
// Idempotent: provisioning is `CREATE ... IF NOT EXISTS`, so re-installing a block is
// free and a restart re-runs the same call over the same schema.
func ProvisionBlockStorage(ctx context.Context, d *deps.Runtime, m *plugin.Manifest) {
	if !needsStorage(m) {
		return
	}
	store := blockstore.New(d.DB)
	if err := store.Provision(ctx, blockstore.KindMCP, m.ID); err != nil {
		d.Log.Error("block storage provision", "block", m.ID, "err", err)
		return
	}
	d.BlockStores[m.ID] = store
}

// BlockStorageOf — this block's own isolated storage. None (not needed / provision
// failed) → nil.
//
// Four things land on this same store: the sandbox's own reads/writes (blockstore.*), the
// owner's config (Config), the code-side fields (CodeConfig), and usage counting (Quota).
// The condition is decided in exactly one place, needsStorage — the cost of writing it
// scattered is that a missed condition only surfaces at runtime: the table doesn't exist.
func BlockStorageOf(d *deps.Runtime, m *plugin.Manifest) *blockstore.Store {
	return d.BlockStores[m.ID]
}

func needsStorage(m *plugin.Manifest) bool {
	// "blockstore." is the declared op-name prefix in the manifests; it happens to
	// match the package name because both were renamed in the same pass.
	return wantsAny(m, "blockstore.") ||
		len(m.Config) > 0 || len(m.CodeConfig) > 0 || m.Quota.Usable()
}

// wantsAny — whether this block calls any host op under the given prefix.
func wantsAny(m *plugin.Manifest, prefix string) bool {
	for _, name := range HostOpsOf(m) {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// HostOpsOf — which host ops this block calls. Read from the manifest, so it's the
// block's own knowledge; inbound convergence dispatches by it.
func HostOpsOf(m *plugin.Manifest) []string {
	if m.Transport.Sandbox == nil {
		return []string{}
	}
	return m.Transport.Sandbox.HostOps
}

// boundBlockStore — the generic blockstore.Store bound to one block's namespace.
type boundBlockStore struct {
	store *blockstore.Store
	kind  blockstore.Kind
	id    string
}

func (b boundBlockStore) Insert(
	ctx context.Context, collection string, doc json.RawMessage,
) (string, error) {
	id, err := b.store.Insert(ctx, b.kind, b.id, collection, doc)
	if err != nil {
		return "", fmt.Errorf("blockstore insert: %w", err)
	}
	return id, nil
}

func (b boundBlockStore) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := b.store.Query(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("blockstore query: %w", err)
	}
	return docs, nil
}

func (b boundBlockStore) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Count(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("blockstore count: %w", err)
	}
	return n, nil
}

func (b boundBlockStore) Delete(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Delete(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("blockstore delete: %w", err)
	}
	return n, nil
}

// QueryRecords / DeleteByID — reads that include the record id, and delete by id. If a
// block can't reach its own records' ids, a duplicate is bound to grow somewhere else
// (see the note on blockdesk.BoundStore).
func (b boundBlockStore) QueryRecords(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]blockdesk.BoundRecord, error) {
	recs, err := b.store.QueryWithIDs(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("blockstore query records: %w", err)
	}
	out := make([]blockdesk.BoundRecord, 0, len(recs))
	for i := range recs {
		out = append(out, blockdesk.BoundRecord{ID: recs[i].ID, Doc: recs[i].Doc})
	}
	return out, nil
}

func (b boundBlockStore) DeleteByID(
	ctx context.Context, collection, recordID string,
) (int64, error) {
	n, err := b.store.DeleteByID(ctx, b.kind, b.id, collection, recordID)
	if err != nil {
		return 0, fmt.Errorf("blockstore delete by id: %w", err)
	}
	return n, nil
}

// Claim / Release — single-winner locking. Closes the window in the middle of "check then
// act" (F-B-15).
func (b boundBlockStore) Claim(
	ctx context.Context, collection, key string, ttlSeconds int,
) (bool, error) {
	got, err := b.store.Claim(ctx, blockstore.ClaimKey{
		Kind: b.kind, ID: b.id, Collection: collection, Key: key,
	}, time.Duration(ttlSeconds)*time.Second)
	if err != nil {
		return false, fmt.Errorf("blockstore claim: %w", err)
	}
	return got, nil
}

func (b boundBlockStore) Release(ctx context.Context, collection, key string) error {
	if err := b.store.Release(ctx, blockstore.ClaimKey{
		Kind: b.kind, ID: b.id, Collection: collection, Key: key,
	}); err != nil {
		return fmt.Errorf("blockstore release: %w", err)
	}
	return nil
}

// boundBlockConfig — the config read port bound to (kind, id, declaration): the sandbox can
// only ask for "my own config".
type boundBlockConfig struct {
	cfg  *blockconfig.Store
	decl []plugin.ConfigField
}

// BlockConfigFor — wraps this block's isolated storage into its own config read/write port.
func BlockConfigFor(store *blockstore.Store, blockID string) *blockconfig.Store {
	return blockconfig.New(store, blockstore.KindMCP, blockID)
}

func (b boundBlockConfig) Values(
	ctx context.Context, ownerID string,
) (map[string]json.RawMessage, error) {
	values, err := b.cfg.Values(ctx, ownerID, b.decl)
	if err != nil {
		return nil, fmt.Errorf("block config: %w", err)
	}
	return values, nil
}

// CorpusScopeHooks — install a fragment gate on every block that reaches into the corpus.
//
// Keyed by what a block DECLARES it calls (`host_ops: corpus_*`), not by its id. The id was
// written into the composition root — one literal, "corpus.retrieval" — which is the host
// holding a list of which blocks ship. A second block that read the corpus, whether shipped
// or installed by the owner, would have missed the gate in silence: its prompt fragment
// would have gone out to a visitor whose scope reaches nothing.
//
// The corpus is the host's own data, so the host may know its own op names. It may not know
// which plugins call them.
func CorpusScopeHooks(
	gate func(*registry.AssembleInput) bool,
) map[string]mount.BlockHooks {
	all := BuiltinManifests()
	out := make(map[string]mount.BlockHooks, len(all))
	for i := range all {
		if wantsAny(&all[i], corpusOpPrefix) {
			out[all[i].ID] = mount.BlockHooks{Fragment: gate}
		}
	}
	return out
}

// corpusOpPrefix — the host-op family that reads corpus content (corpus_search, corpus_read,
// corpus_list, …). One underscore, not a dot: these are the visitor-side corpus ops, and
// `corpus.retrieval` the block id is a different string entirely.
const corpusOpPrefix = "corpus_"
