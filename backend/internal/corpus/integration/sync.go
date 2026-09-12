// sync.go —— a sync-mode source (the ingest direction, opposite the action/proxy suppliers).
//
// Action suppliers (openapi/protocol) are the host's hand reaching OUT — a block calls them
// on-demand (calendar/smtp), Nango's Proxy primitive. A sync source is the other direction
// (Nango's Sync/Functions): external content flows IN to the corpus, owner-triggered, unrelated to
// any one chat. Obsidian vault-sync is the first one.
//
// It answers the same three questions a supplier does (Name/Kind/Connected). The
// ingest operation is an interface consumers type-assert to (mirrors how CalendarProxy is fetched
// off a calendar supplier). Unlike the data-driven openapi/protocol builtins, a sync source is
// CODE-WIRED: its ingest needs a live port (the SyncVault repos), injected at the composition root,
// so this layer stays credential/DTO-only and never imports the ingest usecase.

package integration

import "context"

// SyncFile / SyncResult / SyncOpts — what one sync carries — live in sync_dto.go.

// SyncIngester —— the sync-mode block: ingest a batch of external files into the corpus. A
// consumer resolves the active sync source and type-asserts to this.
type SyncIngester interface {
	Ingest(
		ctx context.Context, ownerID string, files []SyncFile, opts SyncOpts,
	) (SyncResult, error)
}

// IngestFunc —— the injected ingest port (composition root wires SyncVault behind it).
type IngestFunc func(
	ctx context.Context, ownerID string, files []SyncFile, opts SyncOpts,
) (SyncResult, error)

// Source —— an external place a corpus syncs from, as corpus needs to see it.
//
// This used to be the supplier layer's own base interface, and carrying it here is the point
// of the move: a document's relationship with the vault it came from is corpus's business,
// not the supplier layer's. Corpus needs a name and a mode; whether the thing behind it dials
// Google or reads an upload is not corpus's concern and never was.
type Source interface {
	Name() string
	// Kind —— "sync" here. An outward-proxying block answers differently, and a
	// consumer that cares reads this rather than type-switching.
	Kind() string
}

// syncSource —— a sync-mode source. Identity lives here; the real ingest is
// delegated to the injected port.
type syncSource struct {
	ingest IngestFunc
	id     string
}

// NewSyncSource —— a code-wired sync source (id = the source name, e.g. "obsidian").
func NewSyncSource(id string, ingest IngestFunc) Source {
	return &syncSource{id: id, ingest: ingest}
}

func (c *syncSource) Name() string { return c.id }

// Kind —— fixed "sync" (consumers know it ingests inward, not proxies outward).
func (*syncSource) Kind() string { return "sync" }

// Connected —— a sync source is owner-upload-triggered, no external credential to verify; it is
// always available (nothing to "connect"). The gate that matters is owner-auth on the route.
func (*syncSource) Connected(_ context.Context, _ string) (bool, error) { return true, nil }

// Ingest —— SyncIngester: delegate to the injected port.
func (c *syncSource) Ingest(
	ctx context.Context, ownerID string, files []SyncFile, opts SyncOpts,
) (SyncResult, error) {
	return c.ingest(ctx, ownerID, files, opts)
}
