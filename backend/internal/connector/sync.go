// sync.go —— sync-mode connector (the ingest direction, opposite the action/proxy connectors).
//
// Action connectors (openapi/protocol) are the host's hand reaching OUT — a capability calls them
// on-demand (calendar/smtp), Nango's Proxy primitive. A sync connector is the other direction
// (Nango's Sync/Functions): external content flows IN to the corpus, owner-triggered, unrelated to
// any one chat. Obsidian vault-sync is the first one.
//
// It shares the same Hub as action connectors (same Connector base: Name/Kind/Connected). The
// ingest operation is a capability consumers type-assert to (mirrors how CalendarProxy is fetched
// off a calendar connector). Unlike the data-driven openapi/protocol builtins, a sync connector is
// CODE-WIRED: its ingest needs a live port (the SyncVault repos), injected at the composition root,
// so this layer stays credential/DTO-only and never imports the ingest usecase.

package connector

import "context"

// SyncFile —— one uploaded vault file (connector-layer DTO; the composition root adapts to/from the
// ingest usecase's own type, keeping this layer free of a usecase import).
type SyncFile struct {
	RelPath string
	Body    []byte
}

// SyncResult —— ingest outcome (owner-facing counts + tolerant per-file errors).
type SyncResult struct {
	Errors  []string
	Created int
	Updated int
	Skipped int
}

// SyncIngester —— the sync-mode capability: ingest a batch of external files into the corpus. A
// consumer resolves the active sync connector and type-asserts to this.
type SyncIngester interface {
	Ingest(ctx context.Context, ownerID string, files []SyncFile) (SyncResult, error)
}

// IngestFunc —— the injected ingest port (composition root wires SyncVault behind it).
type IngestFunc func(ctx context.Context, ownerID string, files []SyncFile) (SyncResult, error)

// syncConnector —— a sync-mode connector. Identity lives in the connector layer (Hub sees it
// uniformly); the real ingest is delegated to the injected port.
type syncConnector struct {
	ingest IngestFunc
	id     string
}

// NewSyncConnector —— a code-wired sync connector (id = the connector name, e.g. "obsidian").
func NewSyncConnector(id string, ingest IngestFunc) Connector {
	return &syncConnector{id: id, ingest: ingest}
}

func (c *syncConnector) Name() string { return c.id }

// Kind —— fixed "sync" (consumers know it ingests inward, not proxies outward).
func (*syncConnector) Kind() string { return "sync" }

// Connected —— a sync connector is owner-upload-triggered, no external credential to verify; it is
// always available (nothing to "connect"). The gate that matters is owner-auth on the route.
func (*syncConnector) Connected(_ context.Context, _ string) (bool, error) { return true, nil }

// Ingest —— SyncIngester: delegate to the injected port.
func (c *syncConnector) Ingest(
	ctx context.Context, ownerID string, files []SyncFile,
) (SyncResult, error) {
	return c.ingest(ctx, ownerID, files)
}
