// api_tokens.go —— APITokenRepo wrap sqlc 生成的 dbq query。
// 对齐 youteacher 简化：撤销 = 硬删，无 prefix 字段，scope 留 schema 占位。

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

// APITokenRepo 提供 API token CRUD。
type APITokenRepo struct {
	pool *Pool
}

// NewAPITokenRepo 构造。
func NewAPITokenRepo(pool *Pool) *APITokenRepo {
	return &APITokenRepo{pool: pool}
}

// Create 写入新 token。caller 之前已经生成了明文 + 算了 hash。
func (r *APITokenRepo) Create(
	ctx context.Context, ownerID, name, tokenHash string,
) (domain.APIToken, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return domain.APIToken{}, fmt.Errorf("parse owner id: %w", err)
	}
	q := dbq.New(r.pool)
	row, err := q.CreateAPIToken(ctx, dbq.CreateAPITokenParams{
		OwnerID:   ownerUUID,
		Name:      name,
		TokenHash: tokenHash,
	})
	if err != nil {
		return domain.APIToken{}, fmt.Errorf("create api token: %w", err)
	}
	return toDomainAPIToken(&row), nil
}

// ListByOwner 返回 owner 的全部 active token（metadata 字段；不含 hash）。
func (r *APITokenRepo) ListByOwner(ctx context.Context, ownerID string) ([]domain.APIToken, error) {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	q := dbq.New(r.pool)
	rows, err := q.ListAPITokensByOwner(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list api tokens: %w", err)
	}
	out := make([]domain.APIToken, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainAPITokenMetadata(&rows[i]))
	}
	return out, nil
}

// VerifyAndTouch 用 hash 校验 token，命中则 UPDATE last_used_at + 返回 owner_id。
// 没命中返回 domain.ErrUnauthorized。touch 失败时 log warn 但不影响 auth 结果
// （touch 是 best-effort —— 失败原因通常是临时网络抖动，不该让 owner 的 AI
// 客户端无法继续工作）。
func (r *APITokenRepo) VerifyAndTouch(
	ctx context.Context, log *slog.Logger, tokenHash string,
) (string, error) {
	q := dbq.New(r.pool)
	row, err := q.GetAPITokenByHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrUnauthorized
		}
		return "", fmt.Errorf("get api token: %w", err)
	}
	if terr := q.TouchAPIToken(ctx, row.ID); terr != nil {
		log.Warn("touch api token (non-fatal)", "err", terr)
	}
	return formatUUID(row.OwnerID), nil
}

// Delete 硬删 token（撤销 = DELETE）。owner_id 校验确保只能删自己的。
func (r *APITokenRepo) Delete(ctx context.Context, ownerID, tokenID string) error {
	ownerUUID, err := parseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	tokenUUID, err := parseUUID(tokenID)
	if err != nil {
		return fmt.Errorf("parse token id: %w", err)
	}
	q := dbq.New(r.pool)
	if derr := q.DeleteAPIToken(ctx, dbq.DeleteAPITokenParams{
		ID: tokenUUID, OwnerID: ownerUUID,
	}); derr != nil {
		return fmt.Errorf("delete api token: %w", derr)
	}
	return nil
}

func toDomainAPIToken(t *dbq.ApiToken) domain.APIToken {
	return domain.APIToken{
		ID:         formatUUID(t.ID),
		Name:       t.Name,
		CreatedAt:  t.CreatedAt.Time,
		LastUsedAt: tsPtr(t.LastUsedAt),
	}
}

func toDomainAPITokenMetadata(r *dbq.ListAPITokensByOwnerRow) domain.APIToken {
	return domain.APIToken{
		ID:         formatUUID(r.ID),
		Name:       r.Name,
		CreatedAt:  r.CreatedAt.Time,
		LastUsedAt: tsPtr(r.LastUsedAt),
	}
}

func tsPtr(ts pgtype.Timestamptz) *time.Time {
	if !ts.Valid {
		return nil
	}
	t := ts.Time
	return &t
}
