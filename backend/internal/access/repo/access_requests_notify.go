// access_requests_notify.go —— the owner-notification bookkeeping on access_requests: which
// requests took one of the owner's notification slots (the email-bomb cap) and which were sent.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

type requestIDs struct {
	owner   pgtype.UUID
	request pgtype.UUID
}

func parseRequestIDs(ownerID, id string) (requestIDs, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return requestIDs{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	req, err := pgstore.ParseUUID(id)
	if err != nil {
		return requestIDs{}, fmt.Errorf("parse request id: %w", err)
	}
	return requestIDs{owner: owner, request: req}, nil
}

// ClaimNotifySlot —— takes one of the owner's notification slots for this request: at most
// limit per window, per owner. A request that already holds a slot (a retry after a failed send)
// keeps it; one already sent needs nothing. Serialised per owner by an advisory lock, so two
// workers cannot both take the last slot.
func (r *RequestRepo) ClaimNotifySlot(
	ctx context.Context, ownerID, id string, limit int, window time.Duration,
) (entity.NotifySlot, error) {
	ids, err := parseRequestIDs(ownerID, id)
	if err != nil {
		return entity.NotifyDropped, err
	}
	out := entity.NotifyDropped
	err = pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		var cerr error
		out, cerr = claimNotifySlot(ctx, tx, ids, limit, window)
		return cerr
	})
	return out, err //nolint:wrapcheck // each step names itself
}

func claimNotifySlot(
	ctx context.Context, tx pgstore.Tx, ids requestIDs, limit int, window time.Duration,
) (entity.NotifySlot, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"access-request-notify:"+pgstore.FormatUUID(ids.owner)); err != nil {
		return entity.NotifyDropped, fmt.Errorf("lock owner notify slots: %w", err)
	}
	row, err := readNotifySlot(ctx, tx, ids)
	switch {
	case err != nil:
		return entity.NotifyDropped, err
	case row.sent:
		return entity.NotifySent, nil
	case row.claimed:
		return entity.NotifySend, nil
	}
	return takeNotifySlot(ctx, tx, ids, limit, window)
}

// slotRow —— whether the request already holds a slot, and whether it was sent.
type slotRow struct {
	claimed, sent bool
}

func readNotifySlot(ctx context.Context, tx pgstore.Tx, ids requestIDs) (slotRow, error) {
	var row slotRow
	err := tx.QueryRow(ctx, `SELECT notify_claimed_at IS NOT NULL, notified_at IS NOT NULL
		FROM access_requests WHERE id = $1 AND owner_id = $2`, ids.request, ids.owner,
	).Scan(&row.claimed, &row.sent)
	if errors.Is(err, pgx.ErrNoRows) {
		return row, entity.ErrAccessRequestNotFound
	}
	if err != nil {
		return row, fmt.Errorf("read notify slot: %w", err)
	}
	return row, nil
}

// takeNotifySlot —— the slot, if the owner has one left in this window.
func takeNotifySlot(
	ctx context.Context, tx pgstore.Tx, ids requestIDs, limit int, window time.Duration,
) (entity.NotifySlot, error) {
	var used int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM access_requests
		WHERE owner_id = $1 AND notify_claimed_at > now() - make_interval(secs => $2)`,
		ids.owner, window.Seconds()).Scan(&used); err != nil {
		return entity.NotifyDropped, fmt.Errorf("count notify slots: %w", err)
	}
	if used >= limit {
		return entity.NotifyDropped, nil
	}
	const take = `UPDATE access_requests SET notify_claimed_at = now() WHERE id = $1`
	if _, err := tx.Exec(ctx, take, ids.request); err != nil {
		return entity.NotifyDropped, fmt.Errorf("take notify slot: %w", err)
	}
	return entity.NotifySend, nil
}

// MarkNotified —— the owner notification went out (send, then mark).
func (r *RequestRepo) MarkNotified(ctx context.Context, ownerID, id string) error {
	ids, err := parseRequestIDs(ownerID, id)
	if err != nil {
		return err
	}
	if _, err = r.conn().Exec(ctx, `UPDATE access_requests SET notified_at = now()
		WHERE id = $1 AND owner_id = $2`, ids.request, ids.owner); err != nil {
		return fmt.Errorf("mark owner notified: %w", err)
	}
	return nil
}
