// storage.go — a capability's **own** storage and config, bound to its own namespace.
//
// The binding happens at construction time: the interface carries no kind / id, so the sandbox
// side has no path at all to "fill in someone else's table" — isolation is built in by
// construction, not validated per request. The schema name is derived from **an id the host
// trusts** (mcp_<id>), never taken from the plugin's request.

package axiscap

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capconfig"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
)

// CapabilityStorageInit — at startup, provisions one schema (mcp_<id>) for every capability
// that **needs** storage; every wiring point pulls from here afterward.
//
// Once, not once per wiring point: provision is DDL, so running it repeatedly is both slow and
// scatters the fact "does this capability have storage" into a separate check at each site.
func CapabilityStorageInit(ctx context.Context, d *deps.Runtime) {
	manifests := BuiltinManifests()
	for i := range manifests {
		m := &manifests[i]
		if !needsStorage(m) {
			continue
		}
		store := capstore.New(d.DB)
		if err := store.Provision(ctx, capstore.KindMCP, m.ID); err != nil {
			d.Log.Error("capability storage provision", "cap", m.ID, "err", err)
			continue
		}
		d.CapStores[m.ID] = store
	}
}

// CapabilityStorage — this capability's own isolated storage. None (not needed / provision
// failed) → nil.
//
// Four things land on this same store: the sandbox's own reads/writes (capstore.*), the
// owner's config (Config), the code-side fields (CodeConfig), and usage counting (Quota).
// The condition is decided in exactly one place, needsStorage — the cost of writing it
// scattered is that a missed condition only surfaces at runtime: the table doesn't exist.
func CapabilityStorage(d *deps.Runtime, m *mcpplugin.Manifest) *capstore.Store {
	return d.CapStores[m.ID]
}

func needsStorage(m *mcpplugin.Manifest) bool {
	return wantsAny(m, "capstore.") ||
		len(m.Config) > 0 || len(m.CodeConfig) > 0 || m.Quota.Usable()
}

// wantsAny — whether this capability calls any host op under the given prefix.
func wantsAny(m *mcpplugin.Manifest, prefix string) bool {
	for _, name := range HostOpsOf(m) {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// HostOpsOf — which host ops this capability calls. Read from the manifest, so it's the
// capability axis's own knowledge; inbound convergence dispatches by it.
func HostOpsOf(m *mcpplugin.Manifest) []string {
	if m.Transport.Sandbox == nil {
		return []string{}
	}
	return m.Transport.Sandbox.HostOps
}

// boundCapStore — the generic capstore.Store bound to one capability's namespace.
type boundCapStore struct {
	store *capstore.Store
	kind  capstore.Kind
	id    string
}

func (b boundCapStore) Insert(
	ctx context.Context, collection string, doc json.RawMessage,
) (string, error) {
	id, err := b.store.Insert(ctx, b.kind, b.id, collection, doc)
	if err != nil {
		return "", fmt.Errorf("capstore insert: %w", err)
	}
	return id, nil
}

func (b boundCapStore) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := b.store.Query(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capstore query: %w", err)
	}
	return docs, nil
}

func (b boundCapStore) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Count(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capstore count: %w", err)
	}
	return n, nil
}

func (b boundCapStore) Delete(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Delete(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capstore delete: %w", err)
	}
	return n, nil
}

// QueryRecords / DeleteByID — reads that include the record id, and delete by id. If a
// capability can't reach its own records' ids, a duplicate is bound to grow somewhere else
// (see the note on capstoreroutes.BoundStore).
func (b boundCapStore) QueryRecords(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]capstoreroutes.BoundRecord, error) {
	recs, err := b.store.QueryWithIDs(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capstore query records: %w", err)
	}
	out := make([]capstoreroutes.BoundRecord, 0, len(recs))
	for i := range recs {
		out = append(out, capstoreroutes.BoundRecord{ID: recs[i].ID, Doc: recs[i].Doc})
	}
	return out, nil
}

func (b boundCapStore) DeleteByID(
	ctx context.Context, collection, recordID string,
) (int64, error) {
	n, err := b.store.DeleteByID(ctx, b.kind, b.id, collection, recordID)
	if err != nil {
		return 0, fmt.Errorf("capstore delete by id: %w", err)
	}
	return n, nil
}

// Claim / Release — single-winner locking. Closes the window in the middle of "check then
// act" (F-B-15).
func (b boundCapStore) Claim(
	ctx context.Context, collection, key string, ttlSeconds int,
) (bool, error) {
	got, err := b.store.Claim(ctx, capstore.ClaimKey{
		Kind: b.kind, ID: b.id, Collection: collection, Key: key,
	}, time.Duration(ttlSeconds)*time.Second)
	if err != nil {
		return false, fmt.Errorf("capstore claim: %w", err)
	}
	return got, nil
}

func (b boundCapStore) Release(ctx context.Context, collection, key string) error {
	if err := b.store.Release(ctx, capstore.ClaimKey{
		Kind: b.kind, ID: b.id, Collection: collection, Key: key,
	}); err != nil {
		return fmt.Errorf("capstore release: %w", err)
	}
	return nil
}

// boundCapConfig — the config read port bound to (kind, id, declaration): the sandbox can
// only ask for "my own config".
type boundCapConfig struct {
	cfg  *capconfig.Store
	decl []mcpplugin.ConfigField
}

// CapConfigFor — wraps this capability's isolated storage into its own config read/write port.
func CapConfigFor(store *capstore.Store, capID string) *capconfig.Store {
	return capconfig.New(store, capstore.KindMCP, capID)
}

func (b boundCapConfig) Values(
	ctx context.Context, ownerID string,
) (map[string]json.RawMessage, error) {
	values, err := b.cfg.Values(ctx, ownerID, b.decl)
	if err != nil {
		return nil, fmt.Errorf("capability config: %w", err)
	}
	return values, nil
}
