// codes_page_binding.go —— which page a code opens.
//
// Split out of codes.go (that file hit the 350-line cap). The split boundary isn't
// "ran out of lines, cut wherever": binding is a self-contained concern on this
// table — **the page is a rendering of this code**, authorization, quota, identity,
// and billing all stay unchanged, only what the reader sees changes. It's not the
// same thing as issuing/revoking a code or its quotas.

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

// codeOwnerIDs —— a pair of already-parsed uuids. Using a struct instead of a
// multi-value return keeps revive's function-result-limit from complaining
// (same technique as buildRefIDs).
type codeOwnerIDs struct {
	owner pgtype.UUID
	code  pgtype.UUID
}

func parseCodeAndOwner(ownerID, codeID string) (codeOwnerIDs, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return codeOwnerIDs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	codeUUID, cerr := pgstore.ParseUUID(codeID)
	if cerr != nil {
		return codeOwnerIDs{}, fmt.Errorf(errParseCodeIDPrefix, cerr)
	}
	return codeOwnerIDs{owner: ownerUUID, code: codeUUID}, nil
}

// setCodePageSQL —— resolves slug → page id in **one SQL statement** (a subquery
// carrying owner_id), instead of querying once then writing separately: with two
// steps, a page deleted in the gap between them would get a dangling id written.
// RETURNING reads back the slug **after the bind completes** — echoing the input
// only proves "I received it"; reading it back proves "this is what it is now".
const setCodePageSQL = `
	UPDATE access_codes SET microsite_id = CASE WHEN $3 = '' THEN NULL ELSE (
		SELECT id FROM microsites
		WHERE owner_id = $2 AND slug = $3 AND status != 'deleted'
	) END
	WHERE id = $1 AND owner_id = $2
	RETURNING COALESCE((
		SELECT cp.slug::text FROM microsites cp WHERE cp.id = access_codes.microsite_id
	), '')`

// SetMicrosite —— which page this code opens. An empty slug = unbind, falling
// back to the default visitor chat.
//
// No rows = this code doesn't belong to this owner → ErrCodeInvalid, not a
// silent success.
func (r *CodeRepo) SetMicrosite(
	ctx context.Context, ownerID, codeID, slug string,
) (entity.Code, error) {
	ids, perr := parseCodeAndOwner(ownerID, codeID)
	if perr != nil {
		return entity.Code{}, perr
	}
	var boundSlug string
	err := r.pool.QueryRow(ctx, setCodePageSQL, ids.code, ids.owner, slug).Scan(&boundSlug)
	if err != nil {
		return entity.Code{}, setCodePageErr(err)
	}
	// **Wanted to bind but ended up bound to empty** = that slug doesn't belong to this
	// owner. Silently leaving it as "unbound" is the worst outcome: the owner thinks it
	// connected, while the reader lands on the default chat instead.
	if slug != "" && boundSlug == "" {
		return entity.Code{}, entity.ErrCodeInvalid
	}
	return entity.Code{ID: codeID, MicrositeSlug: boundSlug}, nil
}

func setCodePageErr(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.ErrCodeInvalid
	}
	return fmt.Errorf("set code microsite: %w", err)
}
