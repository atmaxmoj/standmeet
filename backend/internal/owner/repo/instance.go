// InstanceRepo + 原子 claim 流程。
//
// Claim 是 instance 状态变更（is_claimed=true）+ owner 创建组合，需要
// 一个 DB transaction 保证原子性：要么两边都成功，要么都回滚。这个
// 跨 aggregate 的事务直接写在 infra 层（避免引入 UnitOfWork 抽象），
// usecase 调它即可。

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// InstanceRepo 提供 instance_settings 单行的读 + setup token 写。
type InstanceRepo struct {
	pool *pgstore.Pool
}

// NewInstanceRepo 构造 InstanceRepo。
func NewInstanceRepo(pool *pgstore.Pool) *InstanceRepo {
	return &InstanceRepo{pool: pool}
}

// Get 读 instance_settings 单行。
func (r *InstanceRepo) Get(ctx context.Context) (entity.InstanceSettings, error) {
	q := db.New(r.pool)
	row, err := q.GetInstanceSettings(ctx)
	if err != nil {
		return entity.InstanceSettings{}, fmt.Errorf("get instance settings: %w", err)
	}
	return entity.InstanceSettings{
		IsClaimed:         row.IsClaimed,
		MultiTenant:       row.MultiTenant,
		DeployedAt:        row.DeployedAt.Time,
		HasSetupTokenHash: row.SetupTokenHash != nil && *row.SetupTokenHash != "",
		SetupTokenHash:    derefOrEmpty(row.SetupTokenHash),
	}, nil
}

// derefOrEmpty —— NULL 的 text 列读成空串。
func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// IsDomainAllowed —— 给 /internal/tls-ask 用：domain 是否在 allowed_domains
// 白名单里。Caddy on-demand TLS 据此决定是否替它签证书。
func (r *InstanceRepo) IsDomainAllowed(ctx context.Context, dom string) (bool, error) {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return false, err
	}
	return slices.Contains(list, dom), nil
}

// AddAllowedDomain —— 把 domain 加进白名单（去重）。admin / setup 调。
func (r *InstanceRepo) AddAllowedDomain(ctx context.Context, dom string) error {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return err
	}
	if slices.Contains(list, dom) {
		return nil
	}
	return r.writeAllowedDomains(ctx, append(list, dom))
}

// RemoveAllowedDomain —— 从白名单删 domain；不存在也不报错（idempotent）。
func (r *InstanceRepo) RemoveAllowedDomain(ctx context.Context, dom string) error {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return err
	}
	filtered := make([]string, 0, len(list))
	for _, d := range list {
		if d != dom {
			filtered = append(filtered, d)
		}
	}
	if len(filtered) == len(list) {
		return nil
	}
	return r.writeAllowedDomains(ctx, filtered)
}

// ListAllowedDomains —— 返当前白名单（empty slice on empty jsonb）。
func (r *InstanceRepo) ListAllowedDomains(ctx context.Context) ([]string, error) {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return nil, err
	}
	if list == nil {
		return []string{}, nil
	}
	return list, nil
}

// SetSetupTokenHash 把启动时生成的 setup token 的 sha256(hash) 存到
// instance_settings.setup_token_hash。已 claimed 的 instance 不应再调
// 这个（调了也只是 update，没语义意义）。
func (r *InstanceRepo) SetSetupTokenHash(ctx context.Context, hash string) error {
	q := db.New(r.pool)
	if err := q.SetSetupTokenHash(ctx, &hash); err != nil {
		return fmt.Errorf("set setup token hash: %w", err)
	}
	return nil
}

// ClaimAndCreateOwner 在一个 transaction 里做：
//  1. TryClaimInstance(tokenHash) —— 当且仅当 is_claimed=false 且 setup_token_hash
//     匹配时才能成功；UPDATE ... RETURNING 0 行视为失败。
//  2. CreateOwner —— 第一行 owner 入表。
//
// 失败时返回 domain sentinel error；成功时返回新建的 Owner。
func (r *InstanceRepo) ClaimAndCreateOwner(
	ctx context.Context,
	tokenHash string,
	input *entity.CreateOwnerInput,
) (entity.Owner, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("begin tx: %w", err)
	}
	ownerRow, txErr := claimTx(ctx, tx, tokenHash, input)
	if txErr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			return entity.Owner{}, errors.Join(txErr, fmt.Errorf("rollback: %w", rerr))
		}
		return entity.Owner{}, txErr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return entity.Owner{}, fmt.Errorf("commit claim: %w", cerr)
	}
	return ownerRow, nil
}

// claimTx 是 ClaimAndCreateOwner 的内层。
func claimTx(
	ctx context.Context,
	tx pgx.Tx,
	tokenHash string,
	input *entity.CreateOwnerInput,
) (entity.Owner, error) {
	q := db.New(tx)

	if _, err := q.TryClaimInstance(ctx, &tokenHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrInvalidSetupToken
		}
		return entity.Owner{}, fmt.Errorf("try claim: %w", err)
	}

	row, err := q.CreateOwner(ctx, db.CreateOwnerParams{
		Email:        NormalizeEmail(input.Email),
		PasswordHash: input.PasswordHash,
		Handle:       input.Handle,
		FullName:     input.FullName,
		PublicUrl:    input.PublicURL,
	})
	if err != nil {
		return entity.Owner{}, translateCreateOwnerErr(err)
	}
	return toDomainOwner(&row), nil
}

func translateCreateOwnerErr(err error) error {
	constraint, isUnique := pgstore.UniqueViolation(err)
	if !isUnique {
		return fmt.Errorf("create owner: %w", err)
	}
	switch constraint {
	case "owners_email_key":
		return entity.ErrEmailTaken
	case "owners_handle_key":
		return entity.ErrHandleTaken
	default:
		return fmt.Errorf("create owner unique violation %s: %w", constraint, err)
	}
}

// loadAllowedDomains / writeAllowedDomains —— allowed_domains 的 jsonb
// 编解码 helper。放文件尾部满足 funcorder（unexported 在 exported 之后）。

func (r *InstanceRepo) loadAllowedDomains(ctx context.Context) ([]string, error) {
	row, err := db.New(r.pool).GetInstanceSettings(ctx)
	if err != nil {
		return []string{}, fmt.Errorf("get instance settings: %w", err)
	}
	if len(row.AllowedDomains) == 0 {
		return []string{}, nil
	}
	var list []string
	if uerr := json.Unmarshal(row.AllowedDomains, &list); uerr != nil {
		return []string{}, fmt.Errorf("unmarshal allowed domains: %w", uerr)
	}
	return list, nil
}

func (r *InstanceRepo) writeAllowedDomains(ctx context.Context, list []string) error {
	encoded, merr := json.Marshal(list)
	if merr != nil {
		return fmt.Errorf("marshal allowed domains: %w", merr)
	}
	q := db.New(r.pool)
	if eerr := q.SetAllowedDomains(ctx, encoded); eerr != nil {
		return fmt.Errorf("update allowed domains: %w", eerr)
	}
	return nil
}
