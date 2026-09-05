// pagestore_adapter.go — backs owner.PageDocStore with capstore's KindPage, so each custom page
// gets its OWN Postgres schema (page_<id>). Lives at the composition root: the owner domain depends
// only on the PageDocStore interface and never imports capstore. Reads tolerate a page that has no
// schema yet (never written to) as empty — so no read path has to run DDL to provision.

package main

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// pageDocStore adapts capstore (KindPage) to owner.PageDocStore. Every call passes the
// host-resolved pageID; capstore derives + validates the schema name from it, so a caller can
// never name another page's schema.
type pageDocStore struct{ store *capstore.Store }

func newPageDocStore(store *capstore.Store) *pageDocStore { return &pageDocStore{store: store} }

func (p *pageDocStore) Provision(ctx context.Context, pageID string) error {
	return p.store.Provision(ctx, capstore.KindPage, pageID)
}

func (p *pageDocStore) Drop(ctx context.Context, pageID string) error {
	return p.store.Drop(ctx, capstore.KindPage, pageID)
}

func (p *pageDocStore) Insert(
	ctx context.Context, pageID, collection string, doc json.RawMessage,
) (string, error) {
	return p.store.Insert(ctx, capstore.KindPage, pageID, collection, doc)
}

func (p *pageDocStore) Query(
	ctx context.Context, pageID, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := p.store.Query(ctx, capstore.KindPage, pageID, collection, filter)
	if missingSchema(err) {
		return []json.RawMessage{}, nil
	}
	if err != nil {
		return []json.RawMessage{}, err
	}
	return docs, nil
}

func (p *pageDocStore) CountAll(ctx context.Context, pageID string) (int64, error) {
	n, err := p.store.CountAll(ctx, capstore.KindPage, pageID)
	if missingSchema(err) {
		return 0, nil
	}
	return n, err
}

func (p *pageDocStore) AllRecords(
	ctx context.Context, pageID string,
) ([]owner.PageDocument, error) {
	recs, err := p.store.AllRecords(ctx, capstore.KindPage, pageID)
	if missingSchema(err) {
		return []owner.PageDocument{}, nil
	}
	if err != nil {
		return []owner.PageDocument{}, err
	}
	out := make([]owner.PageDocument, 0, len(recs))
	for i := range recs {
		out = append(out, owner.PageDocument{
			ID: recs[i].ID, Collection: recs[i].Collection, Doc: recs[i].Doc,
		})
	}
	return out, nil
}

func (p *pageDocStore) DeleteByID(ctx context.Context, pageID, collection, recordID string) error {
	_, err := p.store.DeleteByID(ctx, capstore.KindPage, pageID, collection, recordID)
	return err
}

// missingSchema — the page has no store yet (never written). Postgres reports this two ways
// depending on the statement: 3F000 invalid_schema_name (the page_<id> schema is absent) or 42P01
// undefined_table (a SELECT names page_<id>.records, and Postgres reports the whole relation
// missing). Reads treat either as "empty", so an unwritten page reads back nothing, never a 500.
func missingSchema(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "3F000" || pgErr.Code == "42P01"
}
