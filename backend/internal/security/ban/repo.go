// banned_ips.go — banned_ips repo (#58-3). Persistence layer for source IPs the
// owner has banned. The enforcement middleware queries via IsBanned; admin CRUD
// goes through Ban / List / Unban.
// ip is stored as text, exact-matched against the host chi.RealIP resolves
// (same convention as conversations.client_ip).

package ban

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/security/db"
)

// BannedIPRepo — repo for the banned_ips table.
type BannedIPRepo struct {
	pool *pgstore.Pool
	q    pgstore.DBTX // nil → the pool; set by With
}

// NewBannedIPRepo constructs a BannedIPRepo.
func NewBannedIPRepo(pool *pgstore.Pool) *BannedIPRepo { return &BannedIPRepo{pool: pool} }

// With —— a copy whose Ban runs on q (the caller's transaction).
func (r *BannedIPRepo) With(q pgstore.DBTX) *BannedIPRepo {
	return &BannedIPRepo{pool: r.pool, q: q}
}

// Pool —— the pool a caller opens its transaction on.
func (r *BannedIPRepo) Pool() *pgstore.Pool { return r.pool }

// IPInput — input for the owner banning one IP. ExpiresAt nil = permanent.
type IPInput struct {
	ExpiresAt *time.Time
	OwnerID   string
	IP        string
	Reason    string
}

// Ban — upsert (banning the same IP again overwrites reason/expires_at).
// Returns the row as persisted.
func (r *BannedIPRepo) Ban(ctx context.Context, in *IPInput) (BannedIP, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return BannedIP{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.conn()).BanIP(ctx, db.BanIPParams{
		OwnerID:   ownerUUID,
		Ip:        in.IP,
		Reason:    in.Reason,
		ExpiresAt: pgstore.ToTimestamptz(in.ExpiresAt),
	})
	if qerr != nil {
		return BannedIP{}, fmt.Errorf("ban ip: %w", qerr)
	}
	return decodeBannedIP(&row), nil
}

// List — one page of the owner's bans (including expired ones, so admin can see
// history; most recent first); the page reports how many bans there are.
func (r *BannedIPRepo) List(
	ctx context.Context, ownerID string, req paging.Request,
) (paging.Page[BannedIP], error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return paging.Page[BannedIP]{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	after, err := pgstore.CursorArgs(req.After)
	if err != nil {
		return paging.Page[BannedIP]{}, fmt.Errorf("list banned ips: %w", err)
	}
	rows, qerr := db.New(r.pool).ListBannedIPsPage(ctx, db.ListBannedIPsPageParams{
		OwnerID: ownerUUID, AfterAt: after.At, AfterID: after.ID, Lim: req.Fetch(),
	})
	if qerr != nil {
		return paging.Page[BannedIP]{}, fmt.Errorf("list banned ips: %w", qerr)
	}
	out := make([]BannedIP, 0, len(rows))
	total := int32(0)
	for i := range rows {
		out = append(out, decodeBannedIP(&rows[i].BannedIp))
		total = rows[i].Total
	}
	return paging.Cut(out, req, func(b *BannedIP) paging.Cursor {
		return paging.Cursor{At: b.CreatedAt, ID: b.ID}
	}).WithTotal(total), nil
}

// Unban — unban by id (owner-scoped). Nonexistent id counts as success (idempotent).
func (r *BannedIPRepo) Unban(ctx context.Context, ownerID, id string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	idUUID, ierr := pgstore.ParseUUID(id)
	if ierr != nil {
		return fmt.Errorf("parse ban id: %w", ierr)
	}
	if derr := db.New(r.pool).UnbanIPByID(ctx,
		db.UnbanIPByIDParams{ID: idUUID, OwnerID: ownerUUID}); derr != nil {
		return fmt.Errorf("unban ip: %w", derr)
	}
	return nil
}

// IsBanned — enforcement query: has the owner banned this IP and is it still unexpired.
func (r *BannedIPRepo) IsBanned(ctx context.Context, ownerID, ip string) (bool, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return false, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	banned, qerr := db.New(r.pool).IsIPBanned(ctx,
		db.IsIPBannedParams{OwnerID: ownerUUID, Ip: ip})
	if qerr != nil {
		return false, fmt.Errorf("is ip banned: %w", qerr)
	}
	return banned, nil
}

// IsBannedAnywhere — public-surface enforcement: is this IP banned and unexpired
// anywhere on this instance (owner-agnostic; v1 is single-owner). The middleware
// calls this once per public request.
func (r *BannedIPRepo) IsBannedAnywhere(ctx context.Context, ip string) (bool, error) {
	banned, qerr := db.New(r.pool).IsIPBannedAnywhere(ctx, ip)
	if qerr != nil {
		return false, fmt.Errorf("is ip banned anywhere: %w", qerr)
	}
	return banned, nil
}

func decodeBannedIP(row *db.BannedIp) BannedIP {
	return BannedIP{
		ID:        pgstore.FormatUUID(row.ID),
		OwnerID:   pgstore.FormatUUID(row.OwnerID),
		IP:        row.Ip,
		Reason:    row.Reason,
		ExpiresAt: pgstore.OptTime(row.ExpiresAt),
		CreatedAt: row.CreatedAt.Time,
	}
}

// conn —— the transaction when bound by With, else the pool.
//
//nolint:ireturn // DBTX is the port both a pool and a transaction satisfy
func (r *BannedIPRepo) conn() pgstore.DBTX {
	if r.q != nil {
		return r.q
	}
	return r.pool
}
