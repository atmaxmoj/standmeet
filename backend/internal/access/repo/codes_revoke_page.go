// codes_revoke_page.go —— revoking every code bound to a page at once, with why (an ephemeral
// page's clock ran out: docs/design/job-loop-retention.md).

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// revokeBoundSQL —— revoke a page's active codes with a reason, naming each.
const revokeBoundSQL = `UPDATE access_codes SET status = 'revoked', revoked_reason = $3
WHERE owner_id = $1 AND microsite_id = $2 AND status = 'active' RETURNING id`

// RevokeBoundToPage —— revokes the page's active codes with a reason; returns their ids (none
// when already revoked: a rerun is a no-op).
func (r *CodeRepo) RevokeBoundToPage(
	ctx context.Context, ownerID, pageID, reason string,
) ([]string, error) {
	rows, err := r.conn().Query(ctx, revokeBoundSQL,
		pgstore.UUIDOrNull(ownerID), pgstore.UUIDOrNull(pageID), reason)
	if err != nil {
		return nil, fmt.Errorf("revoke page codes: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id pgtype.UUID
		if serr := rows.Scan(&id); serr != nil {
			return nil, fmt.Errorf("revoke page codes: %w", serr)
		}
		ids = append(ids, pgstore.FormatUUID(id))
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("revoke page codes: %w", rerr)
	}
	return ids, nil
}
