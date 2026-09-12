// codes_bundle_binding.go —— which bundle a code carries.
//
// Split from codes.go on the same boundary as the page binding next door: this is a
// self-contained fact about the code, not part of issuing or quota-ing one. The
// difference from the page binding is what the fact DECIDES — a page is a rendering,
// authorization unchanged; a bundle is the authorization itself.
//
// The column is nullable and NULL means "no bundle", which is the whole compatibility
// story: every code issued before this existed, and every code issued by a surface that
// does not know about bundles, keeps the role ACL it has always had. Two models stand
// side by side rather than one being rewritten into the other.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// setCodeBundleSQL —— resolves name → bundle id in ONE statement, the same shape as
// setCodePageSQL and for the same reason: querying the name first and writing second
// leaves a window in which the bundle is deleted and a dangling id gets written.
const setCodeBundleSQL = `
	UPDATE access_codes SET bundle_id = CASE WHEN $3 = '' THEN NULL ELSE (
		SELECT id FROM bundles WHERE owner_id = $2 AND name = $3
	) END
	WHERE id = $1 AND owner_id = $2
	RETURNING COALESCE((
		SELECT b.name FROM bundles b WHERE b.id = access_codes.bundle_id
	), '')`

// SetBundle —— bind this code to a bundle by name. An empty name unbinds it, and the
// code falls back to its role's grant.
//
// Reads the name back AFTER the write rather than echoing the input: echoing proves only
// "I received it". A name that does not belong to this owner would otherwise land as
// "unbound", and the owner would believe they had narrowed a code that in fact still
// carries everything the role allows — the exact failure the page binding documents,
// with a security consequence instead of a cosmetic one.
func (r *CodeRepo) SetBundle(
	ctx context.Context, ownerID, codeID, name string,
) (string, error) {
	ids, perr := parseCodeAndOwner(ownerID, codeID)
	if perr != nil {
		return "", perr
	}
	var bound string
	if err := r.pool.QueryRow(
		ctx, setCodeBundleSQL, ids.code, ids.owner, name,
	).Scan(&bound); err != nil {
		return "", bindErr(err)
	}
	// A name was asked for and nothing came back bound: the bundle does not exist. The write
	// succeeded on a row that is now bound to nothing, which is the same shape as "no such
	// code" from the caller's side — both mean the narrowing they asked for did not happen.
	if name != "" && bound == "" {
		return "", entity.ErrCodeInvalid
	}
	return bound, nil
}

// bindErr — no row means the code is not this owner's (or does not exist); anything else is
// the database failing, and the two must not read alike.
func bindErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrCodeInvalid
	}
	return fmt.Errorf("set code bundle: %w", err)
}

// BundleID —— the bundle this code carries, or "".
//
// Read on every visitor assembly, so it is one indexed lookup by primary key and
// nothing more. An unknown code returns ("", nil) rather than an error: a revoked or
// deleted code is refused earlier on its own terms, and turning "no such row" into a
// failure here would make an ordinary rejection look like an instance fault.
func (r *CodeRepo) BundleID(ctx context.Context, ownerID, codeID string) (string, error) {
	ids, perr := parseCodeAndOwner(ownerID, codeID)
	if perr != nil {
		return "", perr
	}
	var bundleID pgtype.UUID
	const q = `SELECT bundle_id FROM access_codes WHERE id = $1 AND owner_id = $2`
	if err := r.pool.QueryRow(ctx, q, ids.code, ids.owner).Scan(&bundleID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("read code bundle: %w", err)
	}
	return pgstore.FormatUUID(bundleID), nil
}

// BundleNames —— code id → bundle name, for every code this owner has.
//
// One query for the whole list, not one per row. The codes screen renders every code the
// owner holds, and a lookup per row is how a screen that was fine with three codes stops
// loading at three hundred — the same reason the page binding resolves its slug in SQL
// rather than in Go.
//
// Codes with no bundle are simply absent from the map. A caller reading a missing key
// gets "", which is the right answer: no bundle.
func (r *CodeRepo) BundleNames(ctx context.Context, ownerID string) (map[string]string, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	const q = `
		SELECT c.id, b.name FROM access_codes c
		JOIN bundles b ON b.id = c.bundle_id
		WHERE c.owner_id = $1`
	rows, qerr := r.pool.Query(ctx, q, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("read code bundle names: %w", qerr)
	}
	defer rows.Close()
	return scanBundleNames(rows)
}

// scanBundleNames — drain the rows into code id → bundle name.
func scanBundleNames(rows pgx.Rows) (map[string]string, error) {
	out := map[string]string{}
	for rows.Next() {
		var id pgtype.UUID
		var name string
		if serr := rows.Scan(&id, &name); serr != nil {
			return nil, fmt.Errorf("scan code bundle name: %w", serr)
		}
		out[pgstore.FormatUUID(id)] = name
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate code bundle names: %w", rerr)
	}
	return out, nil
}
