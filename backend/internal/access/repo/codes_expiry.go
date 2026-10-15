// codes_expiry.go —— moving a code's expiry, and finding the codes whose expiry has passed (the
// rule itself is the database function access_code_expired).

package repo

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// SetExpiry —— move the owner's code's expiry; nil = never. ErrCodeInvalid when no such code.
func (r *CodeRepo) SetExpiry(
	ctx context.Context, ownerID, codeID string, at *time.Time,
) error {
	expires := pgtype.Timestamptz{}
	if at != nil {
		expires = pgtype.Timestamptz{Time: *at, Valid: true}
	}
	n, err := db.New(r.pool).SetAccessCodeExpiry(ctx, db.SetAccessCodeExpiryParams{
		ExpiresAt: expires, ID: pgstore.UUIDOrNull(codeID), OwnerID: pgstore.UUIDOrNull(ownerID),
	})
	if err != nil {
		return fmt.Errorf("set code expiry: %w", err)
	}
	if n == 0 {
		return entity.ErrCodeInvalid
	}
	return nil
}

// ExpiredActiveIDs —— active codes past their expiry, whose sessions should end.
func (r *CodeRepo) ExpiredActiveIDs(ctx context.Context) ([]string, error) {
	ids, err := db.New(r.pool).ExpiredActiveAccessCodeIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("expired codes: %w", err)
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, pgstore.FormatUUID(id))
	}
	return out, nil
}
