// microsite_store.go — a microsite's own persistence namespace, on the isolation model the owner
// for ("nosql式" + "每个page都有自己的命名空间而不是通过id区分"):
//
//   - NoSQL: opaque JSON documents in named collections (no fixed columns to fit into).
//   - Its OWN namespace: each page gets a physically separate Postgres schema (page_<id>, the
//     capstore pattern) — NOT a shared table filtered by id. A query in one page's schema cannot
//     see another page's rows; there is no WHERE clause to forget.
//   - Dropped with it: DeletePage runs DROP SCHEMA CASCADE (DropMicrositeStore); no orphaned data.
//   - Model C: visitor WRITES are off until the owner opens the page. Reads are ungated.
//   - Bounded: a per-page document quota + a per-document size cap. Per-IP rate limiting is at the
//     public route.
//
// The owner domain depends only on the MicrositeDocStore interface; the composition root backs it
// capstore. A caller never supplies a page id — the page is resolved from (owner, slug) here.

package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

const (
	// MicrositeStoreMaxDocs — per-page document cap (quota / leak guard).
	MicrositeStoreMaxDocs = 500
	// MicrositeStoreMaxDocBytes — per-document size cap.
	MicrositeStoreMaxDocBytes = 8 * 1024
	// MicrositeStoreMaxCollectionLen — collection name length cap.
	MicrositeStoreMaxCollectionLen = 64
)

// ErrMicrositeStoreInvalid — the write's collection or document violates a shape/size cap.
var ErrMicrositeStoreInvalid = errors.New("invalid page store write")

// DocWrite — one visitor write: which collection, and the opaque document.
type DocWrite struct {
	Slug       string
	Collection string
	Doc        json.RawMessage
}

// DocQuery — one read: which collection, and an optional JSONB-containment filter.
type DocQuery struct {
	Slug       string
	Collection string
	Filter     json.RawMessage
}

// DocRef — one document addressed for owner-side deletion.
type DocRef struct {
	Slug       string
	Collection string
	RecordID   string
}

// MicrositeDocStore — a per-microsite doc namespace (each its own schema). Backed by capstore at
// the composition root; the owner domain never imports capstore. Every method takes the
// host-resolved pageID, so one page can never address another's namespace.
type MicrositeDocStore interface {
	Provision(ctx context.Context, pageID string) error
	Drop(ctx context.Context, pageID string) error
	Insert(ctx context.Context, pageID, collection string, doc json.RawMessage) (string, error)
	Query(
		ctx context.Context, pageID, collection string, filter json.RawMessage,
	) ([]json.RawMessage, error)
	CountAll(ctx context.Context, pageID string) (int64, error)
	AllRecords(ctx context.Context, pageID string) ([]entity.MicrositeDocument, error)
	DeleteByID(ctx context.Context, pageID, collection, recordID string) error
}

// PublicInsertDoc — the visitor-facing write from the public route: resolve the sole owner (v1
// single-owner), then VisitorInsert. The route never supplies an owner or page id.
func PublicInsertDoc(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, w DocWrite,
) (string, error) {
	soleOwner, err := resolveSoleOwner(ctx, owners)
	if err != nil {
		return "", err
	}
	return VisitorInsert(ctx, deps, soleOwner.ID, w)
}

// PublicQueryDocs — the visitor-facing read from the public route (ungated by store_writable).
func PublicQueryDocs(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, q DocQuery,
) ([]json.RawMessage, error) {
	soleOwner, err := resolveSoleOwner(ctx, owners)
	if err != nil {
		return []json.RawMessage{}, err
	}
	return VisitorQuery(ctx, deps, soleOwner.ID, q)
}

// VisitorInsert — a visitor appends one document to a page collection. Guarded by model C (owner
// opt-in), the doc-size cap, and the per-page quota. Returns the new document's id.
func VisitorInsert(
	ctx context.Context, deps MicrositeDeps, ownerID string, w DocWrite,
) (string, error) {
	page, err := insertablePage(ctx, deps, ownerID, w)
	if err != nil {
		return "", err
	}
	id, ierr := deps.Docs.Insert(ctx, page.ID, w.Collection, w.Doc)
	if ierr != nil {
		return "", fmt.Errorf("insert page doc: %w", ierr)
	}
	return id, nil
}

// insertablePage — resolve + gate the write: valid shape, page exists, owner opened it (model C),
// and the store has capacity (schema provisioned + under quota). Returns the page to write into.
func insertablePage(
	ctx context.Context, deps MicrositeDeps, ownerID string, w DocWrite,
) (entity.Microsite, error) {
	if !validWrite(w) {
		return entity.Microsite{}, ErrMicrositeStoreInvalid
	}
	page, err := lookupPage(ctx, deps, ownerID, w.Slug)
	if err != nil {
		return entity.Microsite{}, err
	}
	if !page.StoreWritable {
		return entity.Microsite{}, entity.ErrMicrositeStoreNotWritable
	}
	if cerr := ensureCapacity(ctx, deps, page.ID); cerr != nil {
		return entity.Microsite{}, cerr
	}
	return page, nil
}

// ensureCapacity — the page's schema exists (provision is idempotent) and it is under the quota.
func ensureCapacity(ctx context.Context, deps MicrositeDeps, pageID string) error {
	if err := deps.Docs.Provision(ctx, pageID); err != nil {
		return fmt.Errorf("provision page store: %w", err)
	}
	return checkQuota(ctx, deps, pageID)
}

func checkQuota(ctx context.Context, deps MicrositeDeps, pageID string) error {
	n, err := deps.Docs.CountAll(ctx, pageID)
	if err != nil {
		return fmt.Errorf("count page store: %w", err)
	}
	if n >= MicrositeStoreMaxDocs {
		return entity.ErrMicrositeStoreQuota
	}
	return nil
}

// VisitorQuery — read a page collection's documents (matching an optional filter). Not gated by
// StoreWritable: a page can display its own data (a poll tally) without opening itself to writes.
func VisitorQuery(
	ctx context.Context, deps MicrositeDeps, ownerID string, q DocQuery,
) ([]json.RawMessage, error) {
	if !validCollection(q.Collection) {
		return []json.RawMessage{}, ErrMicrositeStoreInvalid
	}
	page, err := lookupPage(ctx, deps, ownerID, q.Slug)
	if err != nil {
		return []json.RawMessage{}, err
	}
	docs, qerr := deps.Docs.Query(ctx, page.ID, q.Collection, q.Filter)
	if qerr != nil {
		return []json.RawMessage{}, fmt.Errorf("query page store: %w", qerr)
	}
	return docs, nil
}

// OwnerListDocs — every document a page holds, for the admin management view.
func OwnerListDocs(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) ([]entity.MicrositeDocument, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return []entity.MicrositeDocument{}, err
	}
	docs, lerr := deps.Docs.AllRecords(ctx, page.ID)
	if lerr != nil {
		return []entity.MicrositeDocument{}, fmt.Errorf("list page docs: %w", lerr)
	}
	return docs, nil
}

// OwnerDeleteDoc — the owner removes one document by id from the management view.
func OwnerDeleteDoc(ctx context.Context, deps MicrositeDeps, ownerID string, ref DocRef) error {
	page, err := lookupPage(ctx, deps, ownerID, ref.Slug)
	if err != nil {
		return err
	}
	if derr := deps.Docs.DeleteByID(ctx, page.ID, ref.Collection, ref.RecordID); derr != nil {
		return fmt.Errorf("delete page doc: %w", derr)
	}
	return nil
}

// OwnerClear — wipe a page's data. Drops the page's schema; the next write re-provisions it.
func OwnerClear(ctx context.Context, deps MicrositeDeps, ownerID, slug string) error {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return err
	}
	if derr := deps.Docs.Drop(ctx, page.ID); derr != nil {
		return fmt.Errorf("clear page store: %w", derr)
	}
	return nil
}

// OwnerSetWritable — open or close a page's store to visitor writes (model C toggle).
func OwnerSetWritable(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string, writable bool,
) error {
	if err := deps.Pages.SetStoreWritable(ctx, ownerID, slug, writable); err != nil {
		return fmt.Errorf("set store writable: %w", err)
	}
	return nil
}

// ProvisionMicrositeStore — lifecycle hook: CreatePage provisions the page's schema.
func ProvisionMicrositeStore(ctx context.Context, deps MicrositeDeps, pageID string) error {
	if err := deps.Docs.Provision(ctx, pageID); err != nil {
		return fmt.Errorf("provision page store: %w", err)
	}
	return nil
}

// DropMicrositeStore — lifecycle hook: DeletePage drops its schema (DROP SCHEMA CASCADE = the
// page's data goes with it).
func DropMicrositeStore(ctx context.Context, deps MicrositeDeps, pageID string) error {
	if err := deps.Docs.Drop(ctx, pageID); err != nil {
		return fmt.Errorf("drop page store: %w", err)
	}
	return nil
}

func validWrite(w DocWrite) bool {
	return validCollection(w.Collection) && validDoc(w.Doc)
}

func validCollection(collection string) bool {
	return collection != "" && len(collection) <= MicrositeStoreMaxCollectionLen
}

func validDoc(doc json.RawMessage) bool {
	return len(doc) > 0 && len(doc) <= MicrositeStoreMaxDocBytes && json.Valid(doc)
}
