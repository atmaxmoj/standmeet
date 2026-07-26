// banned_ips.go —— banned_ips repo（#58-3）。owner 封掉的来源 IP 的持久层。
// enforcement middleware 走 IsBanned 查；admin CRUD 走 Ban / List / Unban。
// ip 存 text，精确匹配 chi.RealIP 解出的 host（跟 conversations.client_ip 同口径）。

package security

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// BannedIPRepo —— banned_ips 表 repo。
type BannedIPRepo struct {
	pool *pgstore.Pool
}

// NewBannedIPRepo 构造 BannedIPRepo。
func NewBannedIPRepo(pool *pgstore.Pool) *BannedIPRepo { return &BannedIPRepo{pool: pool} }

// BanIPInput —— owner 封一个 IP 的入参。ExpiresAt nil = 永久。
type BanIPInput struct {
	ExpiresAt *time.Time
	OwnerID   string
	IP        string
	Reason    string
}

// Ban —— upsert（重复封同一 IP 覆盖 reason/expires_at）。返回落库后的行。
func (r *BannedIPRepo) Ban(ctx context.Context, in *BanIPInput) (BannedIP, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return BannedIP{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).BanIP(ctx, dbq.BanIPParams{
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

// List —— owner 的全部封禁（含已过期的，给 admin 看历史；最近的在前）。
func (r *BannedIPRepo) List(ctx context.Context, ownerID string) ([]BannedIP, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListBannedIPs(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list banned ips: %w", qerr)
	}
	out := make([]BannedIP, 0, len(rows))
	for i := range rows {
		out = append(out, decodeBannedIP(&rows[i]))
	}
	return out, nil
}

// Unban —— 按 id 解封（owner-scoped）。不存在视同成功（幂等）。
func (r *BannedIPRepo) Unban(ctx context.Context, ownerID, id string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	idUUID, ierr := pgstore.ParseUUID(id)
	if ierr != nil {
		return fmt.Errorf("parse ban id: %w", ierr)
	}
	if derr := dbq.New(r.pool).UnbanIPByID(ctx,
		dbq.UnbanIPByIDParams{ID: idUUID, OwnerID: ownerUUID}); derr != nil {
		return fmt.Errorf("unban ip: %w", derr)
	}
	return nil
}

// IsBanned —— enforcement 查询：owner 是否封了这个 IP 且未过期。
func (r *BannedIPRepo) IsBanned(ctx context.Context, ownerID, ip string) (bool, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return false, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	banned, qerr := dbq.New(r.pool).IsIPBanned(ctx,
		dbq.IsIPBannedParams{OwnerID: ownerUUID, Ip: ip})
	if qerr != nil {
		return false, fmt.Errorf("is ip banned: %w", qerr)
	}
	return banned, nil
}

// IsBannedAnywhere —— 公开面 enforcement：这个 IP 在本实例上是否被封且未过期
// （不分 owner；v1 单 owner）。middleware 每个公开请求调一次。
func (r *BannedIPRepo) IsBannedAnywhere(ctx context.Context, ip string) (bool, error) {
	banned, qerr := dbq.New(r.pool).IsIPBannedAnywhere(ctx, ip)
	if qerr != nil {
		return false, fmt.Errorf("is ip banned anywhere: %w", qerr)
	}
	return banned, nil
}

func decodeBannedIP(row *dbq.BannedIp) BannedIP {
	return BannedIP{
		ID:        pgstore.FormatUUID(row.ID),
		OwnerID:   pgstore.FormatUUID(row.OwnerID),
		IP:        row.Ip,
		Reason:    row.Reason,
		ExpiresAt: pgstore.OptTime(row.ExpiresAt),
		CreatedAt: row.CreatedAt.Time,
	}
}
