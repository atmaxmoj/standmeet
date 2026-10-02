// microsite_store_writing.go —— a page's store as a shared manuscript
// (docs/design/scenario-s2-collaborative-writing.md).
//
// Host keys are the top-level keys that start with `_`. The host writes them and a client never
// can: `_author` (who wrote it, from the session), `_created_at`, `_status` (published, or pending
// while the owner's review is on). A reader also gets `_id`. The owner's policy per page sets the
// document limit and whether review is on.

package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// hostKeyPrefix —— a top-level document key with this prefix belongs to the host.
const hostKeyPrefix = "_"

// StoreChangedChannel —— the NOTIFY channel a page store change wakes (insert, approve, delete,
// clear); the payload is the page id. Open pages listen through the store stream route and refetch.
const StoreChangedChannel = "standmeet_page_store"

// storeChange —— one change to a page's store, as its event and its wake-up.
type storeChange struct {
	pageID     string
	slug       string
	owner      string
	typ        string
	collection string
	docID      string
}

// recordStoreChange —— the change's event and the open pages' wake-up, on the change's own tx.
func recordStoreChange(
	ctx context.Context, deps MicrositeDeps, tx pgstore.Tx, c *storeChange,
) error {
	data := map[string]string{"collection": c.collection, "doc_id": c.docID}
	if err := deps.Events().With(tx).Record(ctx, c.owner, c.typ, "microsite/"+c.slug,
		data); err != nil {
		return err
	}
	return notifyStoreChanged(ctx, tx, c.pageID)
}

// notifyStoreChanged —— on tx, so the page hears the change only once it committed.
func notifyStoreChanged(ctx context.Context, q pgstore.DBTX, pageID string) error {
	return pgstore.Notify(ctx, q, StoreChangedChannel, pageID)
}

// PublicStorePageID —— the page id behind a public slug (sole owner): the key its store changes are
// announced under.
func PublicStorePageID(
	ctx context.Context, deps MicrositeDeps, owners SoleOwnerLookup, slug string,
) (string, error) {
	soleOwner, err := resolveSoleOwner(ctx, owners)
	if err != nil {
		return "", err
	}
	page, lerr := lookupPage(ctx, deps, soleOwner.ID, slug)
	if lerr != nil {
		return "", lerr
	}
	return page.ID, nil
}

// InsertedDoc —— the receipt of a write: the new document's id, and whether it waits for review.
type InsertedDoc struct {
	ID      string `json:"id"`
	Pending bool   `json:"pending"`
}

// StorePolicyChange —— the fields an owner changes; nil leaves a field as it is.
type StorePolicyChange struct {
	MaxDocs *int32 `json:"max_docs,omitempty"`
	Review  *bool  `json:"review,omitempty"`
}

// hostKeys —— the keys the host stamps on every written document.
type hostKeys struct {
	CreatedAt time.Time        `json:"_created_at"`
	Author    entity.DocAuthor `json:"_author"`
	Status    string           `json:"_status"`
}

// statusUnder —— a new document's status: pending while the owner reviews new documents.
func statusUnder(policy entity.StorePolicy) string {
	if policy.Review {
		return entity.DocPending
	}
	return entity.DocPublished
}

// stampDoc —— the client's document plus the host keys; a client host key is refused.
func stampDoc(w *DocWrite, policy entity.StorePolicy) (json.RawMessage, error) {
	doc, err := clientDoc(w.Doc)
	if err != nil {
		return nil, err
	}
	keys, kerr := keyMap(&hostKeys{
		Author: w.Author, Status: statusUnder(policy), CreatedAt: time.Now().UTC(),
	})
	if kerr != nil {
		return nil, kerr
	}
	maps.Copy(doc, keys)
	out, merr := json.Marshal(doc)
	if merr != nil {
		return nil, fmt.Errorf("stamp doc: %w", merr)
	}
	return out, nil
}

// clientDoc —— the client's document as keys; a top-level host key in it is refused.
func clientDoc(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil || doc == nil {
		return nil, ErrMicrositeStoreInvalid
	}
	for k := range doc {
		if strings.HasPrefix(k, hostKeyPrefix) {
			return nil, ErrMicrositeStoreInvalid
		}
	}
	return doc, nil
}

// keyMap —— the host keys as raw JSON values, ready to merge into a document.
func keyMap(h *hostKeys) (map[string]json.RawMessage, error) {
	b, err := json.Marshal(h)
	if err != nil {
		return nil, fmt.Errorf("stamp doc: %w", err)
	}
	var keys map[string]json.RawMessage
	if uerr := json.Unmarshal(b, &keys); uerr != nil {
		return nil, fmt.Errorf("stamp doc: %w", uerr)
	}
	return keys, nil
}

// publishedDocs —— a collection's documents visitors may see, each with its `_id`.
func publishedDocs(
	ctx context.Context, deps MicrositeDeps, pageID, collection string,
) ([]json.RawMessage, error) {
	recs, err := deps.Docs.QueryRecords(ctx, pageID, collection)
	if err != nil {
		return []json.RawMessage{}, fmt.Errorf("query page store: %w", err)
	}
	out := make([]json.RawMessage, 0, len(recs))
	for i := range recs {
		if doc, ok := visibleWithID(&recs[i]); ok {
			out = append(out, doc)
		}
	}
	return out, nil
}

// visibleWithID —— the document with `_id` added, unless it waits for review. A document written
// before host keys existed has no `_status` and counts as published.
func visibleWithID(rec *entity.MicrositeDocument) (json.RawMessage, bool) {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(rec.Doc, &doc); err != nil || doc == nil {
		return nil, false
	}
	if string(doc["_status"]) == `"`+entity.DocPending+`"` {
		return nil, false
	}
	id, ierr := json.Marshal(rec.ID)
	if ierr != nil {
		return nil, false
	}
	doc["_id"] = id
	out, err := json.Marshal(doc)
	return out, err == nil
}

// SessionOpensPage —— may a visitor session (its code, if any) act on this page: the page opens
// without a code, or the code is bound to it. The agent's page tools ask this first, so a slug
// the browser made up reaches nothing.
func SessionOpensPage(
	ctx context.Context, deps MicrositeDeps, ownerID, slug, codeID string,
) error {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return err
	}
	return pageOpens(ctx, deps, page.ID, func(pageID string) bool {
		if codeID == "" {
			return false
		}
		ok, cerr := CodeOpensPage(ctx, deps, codeID, pageID)
		return cerr == nil && ok
	})
}

// OwnerStorePolicy —— the policy a page's store is under now.
func OwnerStorePolicy(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string,
) (entity.StorePolicy, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return entity.StorePolicy{}, err
	}
	return deps.Pages.StorePolicy(ctx, page.ID)
}

// OwnerSetStorePolicy —— change a page's limit and/or review; returns the policy now in force.
func OwnerSetStorePolicy(
	ctx context.Context, deps MicrositeDeps, ownerID, slug string, c StorePolicyChange,
) (entity.StorePolicy, error) {
	page, err := lookupPage(ctx, deps, ownerID, slug)
	if err != nil {
		return entity.StorePolicy{}, err
	}
	p, perr := deps.Pages.StorePolicy(ctx, page.ID)
	if perr != nil {
		return entity.StorePolicy{}, perr
	}
	p = c.applyTo(p)
	if p.MaxDocs < 1 {
		return entity.StorePolicy{}, ErrMicrositeStoreInvalid
	}
	return p, deps.Pages.SetStorePolicy(ctx, page.ID, p)
}

// applyTo —— the policy with this change's set fields replaced.
func (c StorePolicyChange) applyTo(p entity.StorePolicy) entity.StorePolicy {
	if c.MaxDocs != nil {
		p.MaxDocs = *c.MaxDocs
	}
	if c.Review != nil {
		p.Review = *c.Review
	}
	return p
}

// OwnerApproveDoc —— publish a document that waits for review; visitors see it from now on.
func OwnerApproveDoc(ctx context.Context, deps MicrositeDeps, ownerID string, ref DocRef) error {
	page, err := lookupPage(ctx, deps, ownerID, ref.Slug)
	if err != nil {
		return err
	}
	patch := json.RawMessage(`{"_status":"` + entity.DocPublished + `"}`)
	aerr := pgstore.InTx(ctx, deps.Pages.Pool(), func(tx pgstore.Tx) error {
		if xerr := deps.Docs.Patch(ctx, tx, DocPatch{
			PageID: page.ID, Collection: ref.Collection, RecordID: ref.RecordID, Patch: patch,
		}); xerr != nil {
			return xerr
		}
		return recordStoreChange(ctx, deps, tx, &storeChange{
			owner: ownerID, typ: MicrositeStoreDocApproved, pageID: page.ID, slug: page.Slug,
			collection: ref.Collection, docID: ref.RecordID,
		})
	})
	if aerr != nil {
		return fmt.Errorf("approve page doc: %w", aerr)
	}
	return nil
}

// DocSearch —— a page collection, and the text to look for in it.
type DocSearch struct {
	DocQuery

	Query string
}

// SearchDocs —— the published documents of a collection whose text contains the query (any case).
// ponytail: a scan over at most the page's limit of documents; an index when pages grow past it.
func SearchDocs(
	ctx context.Context, deps MicrositeDeps, ownerID string, s DocSearch,
) ([]json.RawMessage, error) {
	docs, err := VisitorQuery(ctx, deps, ownerID, s.DocQuery)
	if err != nil {
		return []json.RawMessage{}, err
	}
	needle := strings.ToLower(strings.TrimSpace(s.Query))
	out := []json.RawMessage{}
	for _, d := range docs {
		if needle == "" || strings.Contains(strings.ToLower(string(d)), needle) {
			out = append(out, d)
		}
	}
	return out, nil
}
