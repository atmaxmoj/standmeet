// keypairs.go —— KeypairRepo wrap sqlc 生成的 dbq query。
// Create / List / GetByKeyID / Touch / Delete。

package repo

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// KeypairRepo 提供 owner Ed25519 keypair CRUD。
type KeypairRepo struct {
	pool *pgstore.Pool
}

// NewKeypairRepo 构造。
func NewKeypairRepo(pool *pgstore.Pool) *KeypairRepo {
	return &KeypairRepo{pool: pool}
}

// CreateKeypairInput —— Create 入参。
type CreateKeypairInput struct {
	OwnerID      string
	KeyID        string
	PublicKeyPEM string
	Label        string
}

// Create 写入新 keypair (caller 已在外面生成 key_id + 公钥 PEM)。
func (r *KeypairRepo) Create(
	ctx context.Context, in *CreateKeypairInput,
) (entity.Keypair, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.Keypair{}, fmt.Errorf("parse owner id: %w", err)
	}
	q := db.New(r.pool)
	row, err := q.CreateOwnerKeypair(ctx, db.CreateOwnerKeypairParams{
		OwnerID:      ownerUUID,
		KeyID:        in.KeyID,
		PublicKeyPem: in.PublicKeyPEM,
		Label:        in.Label,
	})
	if err != nil {
		return entity.Keypair{}, fmt.Errorf("create owner keypair: %w", err)
	}
	return toDomainKeypair(&row), nil
}

// ListByOwner —— admin UI 用，metadata only (无 PEM)。
func (r *KeypairRepo) ListByOwner(
	ctx context.Context, ownerID string,
) ([]entity.KeypairMetadata, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	q := db.New(r.pool)
	rows, err := q.ListOwnerKeypairs(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list owner keypairs: %w", err)
	}
	out := make([]entity.KeypairMetadata, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainKeypairMetadata(&rows[i]))
	}
	return out, nil
}

// GetByKeyID —— sigv1 验签用 (caller 拿公钥 PEM 验)。不命中返
// ErrKeypairUnauthorized 让上层翻 401 不泄露存在性。
func (r *KeypairRepo) GetByKeyID(
	ctx context.Context, keyID string,
) (entity.Keypair, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerKeypairByKeyID(ctx, keyID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Keypair{}, entity.ErrKeypairUnauthorized
		}
		return entity.Keypair{}, fmt.Errorf("get keypair: %w", err)
	}
	return toDomainKeypair(&row), nil
}

// Touch —— best-effort 更新 last_used_at；失败 log warn 不影响验签结果。
func (r *KeypairRepo) Touch(
	ctx context.Context, log *slog.Logger, keypairID string,
) {
	kpUUID, err := pgstore.ParseUUID(keypairID)
	if err != nil {
		log.Warn("touch keypair: parse id", "err", err)
		return
	}
	q := db.New(r.pool)
	if terr := q.TouchOwnerKeypair(ctx, kpUUID); terr != nil {
		log.Warn("touch keypair (non-fatal)", "err", terr)
	}
}

// Delete —— hard delete (= revoke)。owner_id 同时 WHERE 防止跨 owner 删。
// 0-row 命中也不报错 (调用方自己先 GetByKeyID 验存在性)。
func (r *KeypairRepo) Delete(ctx context.Context, ownerID, keyID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	q := db.New(r.pool)
	if derr := q.DeleteOwnerKeypair(ctx, db.DeleteOwnerKeypairParams{
		KeyID: keyID, OwnerID: ownerUUID,
	}); derr != nil {
		return fmt.Errorf("delete owner keypair: %w", derr)
	}
	return nil
}

func toDomainKeypair(r *db.OwnerKeypair) entity.Keypair {
	return entity.Keypair{
		ID:           pgstore.FormatUUID(r.ID),
		OwnerID:      pgstore.FormatUUID(r.OwnerID),
		KeyID:        r.KeyID,
		PublicKeyPEM: r.PublicKeyPem,
		Label:        r.Label,
		LastUsedAt:   tsPtr(r.LastUsedAt),
		CreatedAt:    r.CreatedAt.Time,
	}
}

func toDomainKeypairMetadata(r *db.ListOwnerKeypairsRow) entity.KeypairMetadata {
	return entity.KeypairMetadata{
		ID:         pgstore.FormatUUID(r.ID),
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
