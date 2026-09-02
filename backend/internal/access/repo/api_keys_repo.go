// api_keys.go —— API-key facade persistence (facade-directions.md). Key CRUD + the auth-time
// secret-hash lookup. Denials + candidacy ("open") live in api_keys_acl.go. Parallel to codes.go.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const errParseKeyIDPrefix = "parse api key id: %w"

// APIKeyRepo —— api_keys (+ its denial and candidacy tables) repo.
type APIKeyRepo struct {
	pool *pgstore.Pool
}

// NewAPIKeyRepo constructs an APIKeyRepo.
func NewAPIKeyRepo(pool *pgstore.Pool) *APIKeyRepo { return &APIKeyRepo{pool: pool} }

// Create —— mint a key row. Returns the persisted row (with generated id + created_at).
func (r *APIKeyRepo) Create(
	ctx context.Context, in *entity.CreateAPIKeyInput,
) (entity.APIKey, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return entity.APIKey{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	roleUUID, rerr := pgstore.ParseUUID(in.AssumedRoleID)
	if rerr != nil {
		return entity.APIKey{}, fmt.Errorf("parse role id: %w", rerr)
	}
	row, qerr := db.New(r.pool).CreateAPIKey(ctx, db.CreateAPIKeyParams{
		OwnerID: ownerUUID, AssumedRoleID: roleUUID, Label: in.Label,
		Prefix: in.Prefix, SecretHash: in.SecretHash, RateLimitRpm: in.RateLimitRPM,
		ExpiresAt: pgstore.ToTimestamptz(in.ExpiresAt),
	})
	if qerr != nil {
		return entity.APIKey{}, fmt.Errorf("create api key: %w", qerr)
	}
	return decodeAPIKey(&row), nil
}

// GetBySecretHash —— auth lookup. Only an active, unexpired key resolves; anything else →
// ErrAPIKeyNotFound (the middleware maps it to 401).
func (r *APIKeyRepo) GetBySecretHash(
	ctx context.Context, hash []byte) (entity.APIKey, error,
) {
	row, err := db.New(r.pool).GetAPIKeyBySecretHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return entity.APIKey{}, entity.ErrAPIKeyNotFound
	}
	if err != nil {
		return entity.APIKey{}, fmt.Errorf("get api key by secret: %w", err)
	}
	return decodeAPIKey(&row), nil
}

// ListByOwner —— all of the owner's keys, newest first (includes revoked, for the admin view).
func (r *APIKeyRepo) ListByOwner(
	ctx context.Context, ownerID string) ([]entity.APIKey, error,
) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListAPIKeysByOwner(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api keys: %w", qerr)
	}
	out := make([]entity.APIKey, 0, len(rows))
	for i := range rows {
		out = append(out, decodeAPIKey(&rows[i]))
	}
	return out, nil
}

// GetByID —— owner-scoped fetch (BOLA guard: a key not owned by ownerID → ErrAPIKeyNotFound).
func (r *APIKeyRepo) GetByID(
	ctx context.Context, id, ownerID string) (entity.APIKey, error,
) {
	idUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return entity.APIKey{}, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return entity.APIKey{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, qerr := db.New(r.pool).GetAPIKeyByID(ctx, db.GetAPIKeyByIDParams{
		ID: idUUID, OwnerID: ownerUUID,
	})
	if errors.Is(qerr, pgx.ErrNoRows) {
		return entity.APIKey{}, entity.ErrAPIKeyNotFound
	}
	if qerr != nil {
		return entity.APIKey{}, fmt.Errorf("get api key: %w", qerr)
	}
	return decodeAPIKey(&row), nil
}

// Revoke —— owner-scoped status flip to 'revoked'.
//
// **Zero rows is a failure, not a no-op.** The UPDATE is scoped by (id, owner_id); an id that isn't
// there — a stale list, a second tab that already revoked it, another owner's key — matches nothing
// and postgres reports no error. Returning nil then tells the owner a key was revoked while it
// keeps letting callers in, which is the worst thing this table can say. Not-there →
// ErrAPIKeyNotFound, the shape Get already uses, and the call CodeRepo.Revoke has always made.
func (r *APIKeyRepo) Revoke(ctx context.Context, id, ownerID string) error {
	idUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	rows, qerr := db.New(r.pool).RevokeAPIKey(ctx, db.RevokeAPIKeyParams{
		ID: idUUID, OwnerID: ownerUUID,
	})
	if qerr != nil {
		return fmt.Errorf("revoke api key: %w", qerr)
	}
	if rows == 0 {
		return entity.ErrAPIKeyNotFound
	}
	return nil
}

// Update —— owner-scoped partial update of label / rate limit.
func (r *APIKeyRepo) Update(
	ctx context.Context, in *entity.UpdateAPIKeyInput,
) (entity.APIKey, error) {
	idUUID, err := pgstore.ParseUUID(in.ID)
	if err != nil {
		return entity.APIKey{}, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return entity.APIKey{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, oerr)
	}
	row, qerr := db.New(r.pool).UpdateAPIKey(ctx, db.UpdateAPIKeyParams{
		Label: in.Label, SetRate: in.SetRate, RateLimitRpm: in.RateLimitRPM,
		ID: idUUID, OwnerID: ownerUUID,
	})
	if errors.Is(qerr, pgx.ErrNoRows) {
		return entity.APIKey{}, entity.ErrAPIKeyNotFound
	}
	if qerr != nil {
		return entity.APIKey{}, fmt.Errorf("update api key: %w", qerr)
	}
	return decodeAPIKey(&row), nil
}

// TouchLastUsed —— best-effort last_used_at bump on a successful call (not owner-scoped: the id
// comes from an already-authenticated key).
func (r *APIKeyRepo) TouchLastUsed(ctx context.Context, id string) error {
	idUUID, err := pgstore.ParseUUID(id)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	if qerr := db.New(r.pool).TouchAPIKeyLastUsed(ctx, idUUID); qerr != nil {
		return fmt.Errorf("touch api key: %w", qerr)
	}
	return nil
}

func decodeAPIKey(row *db.ApiKey) entity.APIKey {
	return entity.APIKey{
		ID:            pgstore.FormatUUID(row.ID),
		OwnerID:       pgstore.FormatUUID(row.OwnerID),
		AssumedRoleID: pgstore.FormatUUID(row.AssumedRoleID),
		Label:         row.Label,
		Prefix:        row.Prefix,
		Status:        row.Status,
		SecretHash:    row.SecretHash,
		RateLimitRPM:  row.RateLimitRpm,
		ExpiresAt:     pgstore.OptTime(row.ExpiresAt),
		LastUsedAt:    pgstore.OptTime(row.LastUsedAt),
		CreatedAt:     row.CreatedAt.Time,
	}
}
