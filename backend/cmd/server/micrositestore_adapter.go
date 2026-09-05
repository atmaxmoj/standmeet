// micrositestore_adapter.go — backs owner.MicrositeDocStore with capstore's KindMicrosite, so each
// microsite gets its OWN Postgres schema (microsite_<id>). Lives at the composition root: the owner
// domain depends only on the MicrositeDocStore interface and never imports capstore. Reads tolerate
// a microsite with no schema yet (never written) as empty — no read path runs DDL to provision.

package main

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// micrositeDocStore adapts capstore (KindMicrosite) to owner.MicrositeDocStore. Every call passes
// host-resolved pageID; capstore derives + validates the schema name from it, so a caller can
// never name another page's schema.
type micrositeDocStore struct{ store *capstore.Store }

func newMicrositeDocStore(store *capstore.Store) *micrositeDocStore {
	return &micrositeDocStore{store: store}
}

func (p *micrositeDocStore) Provision(ctx context.Context, pageID string) error {
	return p.store.Provision(ctx, capstore.KindMicrosite, pageID)
}

func (p *micrositeDocStore) Drop(ctx context.Context, pageID string) error {
	return p.store.Drop(ctx, capstore.KindMicrosite, pageID)
}

func (p *micrositeDocStore) Insert(
	ctx context.Context, pageID, collection string, doc json.RawMessage,
) (string, error) {
	return p.store.Insert(ctx, capstore.KindMicrosite, pageID, collection, doc)
}

func (p *micrositeDocStore) Query(
	ctx context.Context, pageID, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := p.store.Query(ctx, capstore.KindMicrosite, pageID, collection, filter)
	if missingSchema(err) {
		return []json.RawMessage{}, nil
	}
	if err != nil {
		return []json.RawMessage{}, err
	}
	return docs, nil
}

func (p *micrositeDocStore) CountAll(ctx context.Context, pageID string) (int64, error) {
	n, err := p.store.CountAll(ctx, capstore.KindMicrosite, pageID)
	if missingSchema(err) {
		return 0, nil
	}
	return n, err
}

func (p *micrositeDocStore) AllRecords(
	ctx context.Context, pageID string,
) ([]owner.MicrositeDocument, error) {
	recs, err := p.store.AllRecords(ctx, capstore.KindMicrosite, pageID)
	if missingSchema(err) {
		return []owner.MicrositeDocument{}, nil
	}
	if err != nil {
		return []owner.MicrositeDocument{}, err
	}
	out := make([]owner.MicrositeDocument, 0, len(recs))
	for i := range recs {
		out = append(out, owner.MicrositeDocument{
			ID: recs[i].ID, Collection: recs[i].Collection, Doc: recs[i].Doc,
		})
	}
	return out, nil
}

func (p *micrositeDocStore) DeleteByID(
	ctx context.Context, pageID, collection, recordID string,
) error {
	_, err := p.store.DeleteByID(ctx, capstore.KindMicrosite, pageID, collection, recordID)
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
