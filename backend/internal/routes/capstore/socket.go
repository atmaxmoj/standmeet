// Package capstore — the socket inbound controller. capstore's four host ops
// (insert/query/count/delete): an offline-sandboxed cap reads and writes its own isolated
// store over the socket. Classified by domain, it lives with capstore rather than in the
// mechanism bucket. BoundStore is already bound at construction time to one cap's namespace
// (no kind/id in the interface), so the sandbox can't fill in someone else's. cmd wires these
// four onto whichever caps need storage.
package capstore

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// BoundStore — an isolated document store already bound to one cap (no kind/id). cmd binds
// one via capstore.Store to a (kind,id) pair before passing it in.
type BoundStore interface {
	Insert(ctx context.Context, collection string, doc json.RawMessage) (string, error)
	Query(ctx context.Context, collection string, filter json.RawMessage) ([]json.RawMessage, error)
	Count(ctx context.Context, collection string, filter json.RawMessage) (int64, error)
	Delete(ctx context.Context, collection string, filter json.RawMessage) (int64, error)
	// QueryRecords / DeleteByID — read with the record id, and delete by that id.
	//
	// These two used to be marked "host-only (cancel-by-id)": a sandboxed cap couldn't get its
	// own record's id, so "cancel one booking by id" had to be reimplemented again on the
	// host (that implementation still exists — it's what this round removes). When a
	// capability can't reach its own data, a duplicate inevitably grows somewhere else — the
	// same hole as OwnerTools and Config.
	QueryRecords(
		ctx context.Context, collection string, filter json.RawMessage,
	) ([]BoundRecord, error)
	DeleteByID(ctx context.Context, collection, recordID string) (int64, error)
	// Claim / Release — single-winner claim: only one caller gets a given key at a given
	// moment (guaranteed by primary-key conflict, not by arrival order). Any "look then act"
	// step needs this to cover the window in between — without it, two callers arriving at
	// the same time would see the same "free" slot (F-B-15: the same slot gets booked twice).
	Claim(ctx context.Context, collection, key string, ttlSeconds int) (bool, error)
	Release(ctx context.Context, collection, key string) error
}

// BoundRecord — one record: its id plus the document.
type BoundRecord struct {
	ID  string          `json:"id"`
	Doc json.RawMessage `json:"doc"`
}

// Ops — one capability's **own** storage: insert / query / count / delete. store is bound at
// construction time to that capability's namespace, so the sandbox side can't fill in someone
// else's table — the isolation is built in, not checked on every request.
//
// store is nil (this capability didn't ask for storage) -> no ops are exposed. That check
// lives here, not at the aggregation point: a source that has nothing to offer should say so
// itself, rather than making the aggregator remember it for every source.
func Ops(store BoundStore) []hostop.Op {
	if store == nil {
		return []hostop.Op{}
	}
	return []hostop.Op{
		{
			Name: "capstore.insert", Description: "Insert a document into your own collection.",
			Invoke: insertHandler(store),
		},
		{
			Name: "capstore.query", Description: "Query your own collection by JSONB filter.",
			Invoke: queryHandler(store),
		},
		{
			Name: "capstore.count", Description: "Count documents matching a filter.",
			Invoke: countHandler(store),
		},
		{
			Name: "capstore.delete", Description: "Delete documents matching a filter.",
			Invoke: deleteHandler(store),
		},
		{
			Name: "capstore.query_records", Description: "Query, returning records with ids.",
			Invoke: queryRecordsHandler(store),
		},
		{
			Name: "capstore.delete_by_id", Description: "Delete one record by its id.",
			Invoke: deleteByIDHandler(store),
		},
		{
			Name: "capstore.claim",
			Description: "Claim a key for a short while — exactly one caller wins. " +
				"Use it around a look-then-act step so two callers cannot both act on " +
				"what they each saw as free. Returns {claimed:true|false}.",
			Invoke: claimHandler(store),
		},
		{
			Name:        "capstore.release",
			Description: "Release a claim you hold (it also expires on its own).",
			Invoke:      releaseHandler(store),
		},
	}
}

type writeReq struct {
	Collection string          `json:"collection"`
	Doc        json.RawMessage `json:"doc"`
}

type filterReq struct {
	Collection string          `json:"collection"`
	Filter     json.RawMessage `json:"filter"`
}

func insertHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req writeReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.insert: decode: %w", err)
		}
		id, err := store.Insert(ctx, req.Collection, req.Doc)
		if err != nil {
			return nil, fmt.Errorf("capstore.insert: %w", err)
		}
		out, merr := json.Marshal(map[string]string{"id": id})
		if merr != nil {
			return nil, fmt.Errorf("capstore.insert: marshal: %w", merr)
		}
		return out, nil
	}
}

func queryHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.query: decode: %w", err)
		}
		docs, err := store.Query(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.query: %w", err)
		}
		out, merr := json.Marshal(map[string][]json.RawMessage{"records": docs})
		if merr != nil {
			return nil, fmt.Errorf("capstore.query: marshal: %w", merr)
		}
		return out, nil
	}
}

func queryRecordsHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.query_records: decode: %w", err)
		}
		recs, err := store.QueryRecords(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.query_records: %w", err)
		}
		out, merr := json.Marshal(map[string][]BoundRecord{"records": recs})
		if merr != nil {
			return nil, fmt.Errorf("capstore.query_records: marshal: %w", merr)
		}
		return out, nil
	}
}

type byIDReq struct {
	Collection string `json:"collection"`
	RecordID   string `json:"record_id"`
}

func deleteByIDHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req byIDReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.delete_by_id: decode: %w", err)
		}
		n, err := store.DeleteByID(ctx, req.Collection, req.RecordID)
		if err != nil {
			return nil, fmt.Errorf("capstore.delete_by_id: %w", err)
		}
		out, merr := json.Marshal(map[string]int64{"deleted": n})
		if merr != nil {
			return nil, fmt.Errorf("capstore.delete_by_id: marshal: %w", merr)
		}
		return out, nil
	}
}

func countHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.count: decode: %w", err)
		}
		n, err := store.Count(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.count: %w", err)
		}
		out, merr := json.Marshal(map[string]int64{"count": n})
		if merr != nil {
			return nil, fmt.Errorf("capstore.count: marshal: %w", merr)
		}
		return out, nil
	}
}

func deleteHandler(store BoundStore) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req filterReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("capstore.delete: decode: %w", err)
		}
		n, err := store.Delete(ctx, req.Collection, req.Filter)
		if err != nil {
			return nil, fmt.Errorf("capstore.delete: %w", err)
		}
		out, merr := json.Marshal(map[string]int64{"deleted": n})
		if merr != nil {
			return nil, fmt.Errorf("capstore.delete: marshal: %w", merr)
		}
		return out, nil
	}
}
