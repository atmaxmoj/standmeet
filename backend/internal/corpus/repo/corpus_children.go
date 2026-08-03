// corpus_children.go —— shared one-level tree-children plumbing for the isomorphic
// wiki/output genres (#157). Both ListChildren impls parse owner+parent, run their sqlc
// children query, and map rows to meta the same way; the only genre-specific parts are
// the query call and the row→meta mapper, passed as closures.

package repo

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/jackc/pgx/v5/pgtype"
)

// listChildrenMeta —— parse owner+parent, fetch, map. fetch captures limit/offset.
func listChildrenMeta[Row any, Meta any](
	ownerID string, parentID *string,
	fetch func(ownerUUID, parentUUID pgtype.UUID) ([]Row, error),
	mapRow func(Row) Meta,
) ([]Meta, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parentUUID, perr := pgstore.ParseOptionalUUID(parentID)
	if perr != nil {
		return nil, fmt.Errorf("parse parent id: %w", perr)
	}
	rows, qerr := fetch(ownerUUID, parentUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list children: %w", qerr)
	}
	out := make([]Meta, 0, len(rows))
	for i := range rows {
		out = append(out, mapRow(rows[i]))
	}
	return out, nil
}
