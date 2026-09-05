// microsites_store.go —— owner-side management of a microsite's own data store (the per-page
// NoSQL namespace visitors write into, e.g. a poll tally or a sign-up sheet). The runtime write
// path is model-C gated and lives elsewhere; these three ops are the owner's management view:
// see what a page holds, delete one document, or clear the page's store entirely.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func micrositeStoreOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "microsite.store_docs",
			Description: "Every document a page's data store holds, for management.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listMicrositeDocs(deps),
		},
		{
			ID:          "microsite.store_delete_doc",
			Description: "Delete one document from a page's data store by its record id.",
			InputSchema: micrositeStoreDocRefSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteMicrositeDoc(deps),
		},
		{
			ID: "microsite.store_clear",
			Description: "Clear a page's data store — every document goes. The next visitor " +
				"write re-creates the store empty.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      clearMicrositeStore(deps),
		},
	}
}

var micrositeStoreDocRefSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string"},
		"collection":{"type":"string"},
		"record_id":{"type":"string"}
	},
	"required":["slug","collection","record_id"]
}`)

// micrositeDocOut —— one stored document as the management view sees it: a stable id + the
// collection it lives in + the opaque JSON the page wrote.
type micrositeDocOut struct {
	ID         string          `json:"id"`
	Collection string          `json:"collection"`
	Doc        json.RawMessage `json:"doc"`
}

// storeDocsOut —— a page's whole store: the slug and every document in it.
type storeDocsOut struct {
	Slug string            `json:"slug"`
	Docs []micrositeDocOut `json:"docs"`
}

// storeDocRefArgs —— addresses one document for deletion.
type storeDocRefArgs struct {
	Slug       string `json:"slug"`
	Collection string `json:"collection"`
	RecordID   string `json:"record_id"`
}

func listMicrositeDocs(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		docs, err := usecase.OwnerListDocs(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(storeDocsOut{Slug: in.Slug, Docs: toDocOut(docs)})
	}
}

func toDocOut(docs []entity.MicrositeDocument) []micrositeDocOut {
	out := make([]micrositeDocOut, 0, len(docs))
	for i := range docs {
		out = append(out, micrositeDocOut{
			ID: docs[i].ID, Collection: docs[i].Collection, Doc: docs[i].Doc,
		})
	}
	return out
}

func deleteMicrositeDoc(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeStoreDocRef(raw)
		if perr != nil {
			return nil, perr
		}
		ref := usecase.DocRef{Slug: in.Slug, Collection: in.Collection, RecordID: in.RecordID}
		if err := usecase.OwnerDeleteDoc(ctx, deps, ownerID, ref); err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(deletedDocOut{RecordID: in.RecordID, Deleted: true})
	}
}

// deletedDocOut —— the delete receipt: which record went.
type deletedDocOut struct {
	RecordID string `json:"record_id"`
	Deleted  bool   `json:"deleted"`
}

func clearMicrositeStore(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.OwnerClear(ctx, deps, ownerID, in.Slug); err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(clearedStoreOut{Slug: in.Slug, Cleared: true})
	}
}

// clearedStoreOut —— the clear receipt.
type clearedStoreOut struct {
	Slug    string `json:"slug"`
	Cleared bool   `json:"cleared"`
}

func decodeStoreDocRef(raw json.RawMessage) (storeDocRefArgs, error) {
	var in storeDocRefArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs(
		[2]string{"slug", in.Slug}, [2]string{"collection", in.Collection},
		[2]string{"record_id", in.RecordID},
	)
}
