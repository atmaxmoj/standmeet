// keypairs.go —— KeypairRepo wraps sqlc-generated dbq queries.
// Create / List / GetByKeyID / Touch / Delete.

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

// KeypairRepo provides CRUD for an owner's Ed25519 keypairs.
type KeypairRepo struct {
	pool *pgstore.Pool
}

// NewKeypairRepo constructs one.
func NewKeypairRepo(pool *pgstore.Pool) *KeypairRepo {
	return &KeypairRepo{pool: pool}
}

// CreateKeypairInput —— Create's input.
type CreateKeypairInput struct {
	OwnerID      string
	KeyID        string
	PublicKeyPEM string
	Label        string
}

// Create writes a new keypair (the caller has already generated the
// key_id + public-key PEM outside this call).
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

// ListByOwner —— used by the admin UI, metadata only (no PEM).
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

// GetByKeyID —— used for sigv1 signature verification (the caller uses the
// public-key PEM to verify). Returns ErrKeypairUnauthorized on a miss, so
// the layer above can translate to 401 without revealing existence.
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

// Touch —— best-effort update of last_used_at; a failure logs a warning
// and doesn't affect the verification result.
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

// Delete —— hard delete (= revoke). owner_id is also in the WHERE clause,
// preventing a cross-owner delete. A 0-row hit is not an error either
// (the caller already verified existence via GetByKeyID first).
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
