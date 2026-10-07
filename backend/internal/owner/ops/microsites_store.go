// microsites_store.go —— owner-side management of a microsite's own data store (the per-page
// NoSQL namespace visitors write into, e.g. a poll tally or a sign-up sheet). The runtime write
// path is model-C gated and lives elsewhere; these three ops are the owner's management view:
// see what a page holds, delete one document, or clear the page's store entirely.

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func micrositeStoreOps(deps usecase.MicrositeDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "microsite.store_docs",
			Description: "The documents a page's data store holds, newest first, one page at a " +
				"time ({items, next_cursor, total}), for management.",
			InputSchema: paging.Schema(pageSlugSchema),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listMicrositeDocs(deps),
		},
		{
			ID: "microsite.store_delete_doc", Danger: fp.DangerDestructive,
			Description: "Delete one document from a page's data store by its record id.",
			InputSchema: micrositeStoreDocRefSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteMicrositeDoc(deps),
		},
		{
			ID: "microsite.store_approve", Danger: fp.DangerWrite,
			Description: "Approve one document that waits for review (its _status is " +
				"\"pending\"); visitors and the agent see it from now on.",
			InputSchema: micrositeStoreDocRefSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      approveMicrositeDoc(deps),
		},
		{
			ID:          "microsite.store_policy",
			Description: "A page store's rules now: max_docs and review.",
			InputSchema: pageSlugSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getMicrositeStorePolicy(deps),
		},
		{
			ID: "microsite.set_store_policy", Danger: fp.DangerAuthority,
			Description: "Set a page store's rules: max_docs (how many documents it may hold, " +
				"default 500) and review (true: a new document waits for your approval before " +
				"visitors see it; default false). Omitted fields stay as they are.",
			InputSchema: micrositeStorePolicySchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setMicrositeStorePolicy(deps),
		},
		{
			ID: "microsite.store_clear", Danger: fp.DangerDestructive,
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

var micrositeStorePolicySchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"slug":{"type":"string"},
		"max_docs":{"type":"integer","minimum":1},
		"review":{"type":"boolean"}
	},
	"required":["slug"]
}`)

type storePolicyArgs struct {
	usecase.StorePolicyChange

	Slug string `json:"slug"`
}

func approveMicrositeDoc(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeStoreDocRef(raw)
		if perr != nil {
			return nil, perr
		}
		ref := usecase.DocRef{Slug: in.Slug, Collection: in.Collection, RecordID: in.RecordID}
		if err := usecase.OwnerApproveDoc(ctx, deps, ownerID, ref); err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(approvedDocOut{RecordID: in.RecordID, Approved: true})
	}
}

// approvedDocOut —— the approve receipt.
type approvedDocOut struct {
	RecordID string `json:"record_id"`
	Approved bool   `json:"approved"`
}

func getMicrositeStorePolicy(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodePageSlug(raw)
		if perr != nil {
			return nil, perr
		}
		p, err := usecase.OwnerStorePolicy(ctx, deps, ownerID, in.Slug)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(p)
	}
}

func setMicrositeStorePolicy(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in storePolicyArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"slug", in.Slug}); err != nil {
			return nil, err
		}
		p, err := usecase.OwnerSetStorePolicy(ctx, deps, ownerID, in.Slug, in.StorePolicyChange)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(p)
	}
}

// micrositeDocOut —— one stored document as the management view sees it: a stable id + the
// collection it lives in + the opaque JSON the page wrote.
type micrositeDocOut struct {
	ID         string          `json:"id"`
	Collection string          `json:"collection"`
	Doc        json.RawMessage `json:"doc"`
}

// pageSlugArgs —— the store listing's one filter: which page.
type pageSlugArgs struct {
	Slug string `json:"slug"`
}

// storeDocRefArgs —— addresses one document for deletion.
type storeDocRefArgs struct {
	Slug       string `json:"slug"`
	Collection string `json:"collection"`
	RecordID   string `json:"record_id"`
}

func listMicrositeDocs(deps usecase.MicrositeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := paging.ParseArgs[pageSlugArgs](raw)
		if perr != nil {
			return nil, fp.BadInput("invalid arguments: " + perr.Error())
		}
		if err := fp.RequireArgs([2]string{"slug", in.Filter.Slug}); err != nil {
			return nil, err
		}
		page, err := usecase.OwnerListDocs(ctx, deps, ownerID, in.Filter.Slug, in.Req)
		if err != nil {
			return nil, micrositeErr(err)
		}
		return json.Marshal(paging.Each(page, func(d *entity.MicrositeDocument) micrositeDocOut {
			return micrositeDocOut{ID: d.ID, Collection: d.Collection, Doc: d.Doc}
		}))
	}
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
