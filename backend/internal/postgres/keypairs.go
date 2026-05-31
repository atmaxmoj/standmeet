// keypairs.go —— OwnerKeypairRepo wrap sqlc 生成的 dbq query。
// Create / List / GetByKeyID / Touch / Delete。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// OwnerKeypairRepo 提供 owner Ed25519 keypair CRUD。
type OwnerKeypairRepo struct {
	pool *Pool
}

// NewOwnerKeypairRepo 构造。
func NewOwnerKeypairRepo(pool *Pool) *OwnerKeypairRepo {
	return &OwnerKeypairRepo{pool: pool}
}

// CreateKeypairInput —— Create 入参。
type CreateKeypairInput struct {
	OwnerID      string
	KeyID        string
	PublicKeyPEM string
	Label        string
}

// Create 写入新 keypair (caller 已在外面生成 key_id + 公钥 PEM)。
func (r *OwnerKeypairRepo) Create(
	ctx context.Context, in *CreateKeypairInput,
) (domain.OwnerKeypair, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.OwnerKeypair{}, fmt.Errorf("parse owner id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateOwnerKeypair(ctx, dbq.CreateOwnerKeypairParams{
		OwnerID:      ownerUUID,
		KeyID:        in.KeyID,
		PublicKeyPem: in.PublicKeyPEM,
		Label:        in.Label,
	})
	if err != nil {
		return domain.OwnerKeypair{}, fmt.Errorf("create owner keypair: %w", err)
	}
	return toDomainKeypair(&row), nil
}

// ListByOwner —— admin UI 用，metadata only (无 PEM)。
func (r *OwnerKeypairRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]domain.OwnerKeypairMetadata, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListOwnerKeypairs(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list owner keypairs: %w", err)
	}
	out := make([]domain.OwnerKeypairMetadata, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainKeypairMetadata(&rows[i]))
	}
	return out, nil
}

// GetByKeyID —— sigv1 验签用 (caller 拿公钥 PEM 验)。不命中返
// ErrKeypairUnauthorized 让上层翻 401 不泄露存在性。
func (r *OwnerKeypairRepo) GetByKeyID(
	ctx context.Context, keyID string,
) (domain.OwnerKeypair, error) {
	q := dbq.New(r.pool)
	row, err := q.GetOwnerKeypairByKeyID(ctx, keyID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.OwnerKeypair{}, domain.ErrKeypairUnauthorized
		}
		return domain.OwnerKeypair{}, fmt.Errorf("get keypair: %w", err)
	}
	return toDomainKeypair(&row), nil
}

// Touch —— best-effort 更新 last_used_at；失败 log warn 不影响验签结果。
func (r *OwnerKeypairRepo) Touch(
	ctx context.Context, log *slog.Logger, keypairID string,
) {
	kpUUID, err := parseUUID(keypairID)
	if err != nil {
		log.Warn("touch keypair: parse id", "err", err)
		return
	}
	q := dbq.New(r.pool)
	if terr := q.TouchOwnerKeypair(ctx, kpUUID); terr != nil {
		log.Warn("touch keypair (non-fatal)", "err", terr)
	}
}

// Delete —— hard delete (= revoke)。owner_id 同时 WHERE 防止跨 owner 删。
// 0-row 命中也不报错 (调用方自己先 GetByKeyID 验存在性)。
func (r *OwnerKeypairRepo) Delete(ctx context.Context, ownerID, keyID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	q := dbq.New(r.pool)
	if derr := q.DeleteOwnerKeypair(ctx, dbq.DeleteOwnerKeypairParams{
		KeyID: keyID, OwnerID: ownerUUID,
	}); derr != nil {
		return fmt.Errorf("delete owner keypair: %w", derr)
	}
	return nil
}

func toDomainKeypair(r *dbq.OwnerKeypair) domain.OwnerKeypair {
	return domain.OwnerKeypair{
		ID:           formatUUID(r.ID),
		OwnerID:      formatUUID(r.OwnerID),
		KeyID:        r.KeyID,
		PublicKeyPEM: r.PublicKeyPem,
		Label:        r.Label,
		LastUsedAt:   tsPtr(r.LastUsedAt),
		CreatedAt:    r.CreatedAt.Time,
	}
}

func toDomainKeypairMetadata(r *dbq.ListOwnerKeypairsRow) domain.OwnerKeypairMetadata {
	return domain.OwnerKeypairMetadata{
		ID:         formatUUID(r.ID),
		KeyID:      r.KeyID,
		Label:      r.Label,
		LastUsedAt: tsPtr(r.LastUsedAt),
		CreatedAt:  r.CreatedAt.Time,
	}
}

func tsPtr(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}
