// api_keys.go —— API-key facade persistence (facade-directions.md). Key CRUD + the auth-time
// secret-hash lookup. Denials + candidacy ("open") live in api_keys_acl.go. Parallel to codes.go.

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

const errParseKeyIDPrefix = "parse api key id: %w"

// APIKeyRepo —— api_keys (+ its denial and candidacy tables) repo.
type APIKeyRepo struct {
	pool *Pool
}

// NewAPIKeyRepo 构造 APIKeyRepo。
func NewAPIKeyRepo(pool *Pool) *APIKeyRepo { return &APIKeyRepo{pool: pool} }

// Create —— mint a key row. Returns the persisted row (with generated id + created_at).
func (r *APIKeyRepo) Create(
	ctx context.Context, in *domain.CreateAPIKeyInput,
) (domain.APIKey, error) {
	ownerUUID, err := parseUUID(in.OwnerID)
	if err != nil {
		return domain.APIKey{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	roleUUID, rerr := parseUUID(in.AssumedRoleID)
	if rerr != nil {
		return domain.APIKey{}, fmt.Errorf("parse role id: %w", rerr)
	}
	row, qerr := dbq.New(r.pool).CreateAPIKey(ctx, dbq.CreateAPIKeyParams{
		OwnerID: ownerUUID, AssumedRoleID: roleUUID, Label: in.Label,
		Prefix: in.Prefix, SecretHash: in.SecretHash, RateLimitRpm: in.RateLimitRPM,
		ExpiresAt: toTimestamptz(in.ExpiresAt),
	})
	if qerr != nil {
		return domain.APIKey{}, fmt.Errorf("create api key: %w", qerr)
	}
	return decodeAPIKey(&row), nil
}

// GetBySecretHash —— auth lookup. Only an active, unexpired key resolves; anything else →
// ErrAPIKeyNotFound (the middleware maps it to 401).
func (r *APIKeyRepo) GetBySecretHash(ctx context.Context, hash []byte) (domain.APIKey, error) {
	row, err := dbq.New(r.pool).GetAPIKeyBySecretHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.APIKey{}, domain.ErrAPIKeyNotFound
	}
	if err != nil {
		return domain.APIKey{}, fmt.Errorf("get api key by secret: %w", err)
	}
	return decodeAPIKey(&row), nil
}

// ListByOwner —— all of the owner's keys, newest first (includes revoked, for the admin view).
func (r *APIKeyRepo) ListByOwner(ctx context.Context, ownerID string) ([]domain.APIKey, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListAPIKeysByOwner(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list api keys: %w", qerr)
	}
	out := make([]domain.APIKey, 0, len(rows))
	for i := range rows {
		out = append(out, decodeAPIKey(&rows[i]))
	}
	return out, nil
}

// GetByID —— owner-scoped fetch (BOLA guard: a key not owned by ownerID → ErrAPIKeyNotFound).
func (r *APIKeyRepo) GetByID(ctx context.Context, id, ownerID string) (domain.APIKey, error) {
	idUUID, err := parseUUID(id)
	if err != nil {
		return domain.APIKey{}, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.APIKey{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, qerr := dbq.New(r.pool).GetAPIKeyByID(ctx, dbq.GetAPIKeyByIDParams{
		ID: idUUID, OwnerID: ownerUUID,
	})
	if errors.Is(qerr, pgx.ErrNoRows) {
		return domain.APIKey{}, domain.ErrAPIKeyNotFound
	}
	if qerr != nil {
		return domain.APIKey{}, fmt.Errorf("get api key: %w", qerr)
	}
	return decodeAPIKey(&row), nil
}

// Revoke —— owner-scoped status flip to 'revoked'. Idempotent.
func (r *APIKeyRepo) Revoke(ctx context.Context, id, ownerID string) error {
	idUUID, err := parseUUID(id)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	if qerr := dbq.New(r.pool).RevokeAPIKey(ctx, dbq.RevokeAPIKeyParams{
		ID: idUUID, OwnerID: ownerUUID,
	}); qerr != nil {
		return fmt.Errorf("revoke api key: %w", qerr)
	}
	return nil
}

// Update —— owner-scoped partial update of label / rate limit.
func (r *APIKeyRepo) Update(
	ctx context.Context, in *domain.UpdateAPIKeyInput,
) (domain.APIKey, error) {
	idUUID, err := parseUUID(in.ID)
	if err != nil {
		return domain.APIKey{}, fmt.Errorf(errParseKeyIDPrefix, err)
	}
	ownerUUID, oerr := parseUUID(in.OwnerID)
	if oerr != nil {
		return domain.APIKey{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, qerr := dbq.New(r.pool).UpdateAPIKey(ctx, dbq.UpdateAPIKeyParams{
		Label: in.Label, SetRate: in.SetRate, RateLimitRpm: in.RateLimitRPM,
		ID: idUUID, OwnerID: ownerUUID,
	})
	if errors.Is(qerr, pgx.ErrNoRows) {
		return domain.APIKey{}, domain.ErrAPIKeyNotFound
	}
	if qerr != nil {
		return domain.APIKey{}, fmt.Errorf("update api key: %w", qerr)
	}
	return decodeAPIKey(&row), nil
}

// TouchLastUsed —— best-effort last_used_at bump on a successful call (not owner-scoped: the id
// comes from an already-authenticated key).
func (r *APIKeyRepo) TouchLastUsed(ctx context.Context, id string) error {
	idUUID, err := parseUUID(id)
	if err != nil {
		return fmt.Errorf(errParseKeyIDPrefix, err)
	}
	if qerr := dbq.New(r.pool).TouchAPIKeyLastUsed(ctx, idUUID); qerr != nil {
		return fmt.Errorf("touch api key: %w", qerr)
	}
	return nil
}

func decodeAPIKey(row *dbq.ApiKey) domain.APIKey {
	return domain.APIKey{
		ID:            formatUUID(row.ID),
		OwnerID:       formatUUID(row.OwnerID),
		AssumedRoleID: formatUUID(row.AssumedRoleID),
		Label:         row.Label,
		Prefix:        row.Prefix,
		Status:        row.Status,
		SecretHash:    row.SecretHash,
		RateLimitRPM:  row.RateLimitRpm,
		ExpiresAt:     optTime(row.ExpiresAt),
		LastUsedAt:    optTime(row.LastUsedAt),
		CreatedAt:     row.CreatedAt.Time,
	}
}
