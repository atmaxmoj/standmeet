// InstanceRepo + 原子 claim 流程。
//
// Claim 是 instance 状态变更（is_claimed=true）+ owner 创建组合，需要
// 一个 DB transaction 保证原子性：要么两边都成功，要么都回滚。这个
// 跨 aggregate 的事务直接写在 infra 层（避免引入 UnitOfWork 抽象），
// usecase 调它即可。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// InstanceRepo 提供 instance_settings 单行的读 + setup token 写。
type InstanceRepo struct {
	pool *Pool
}

// NewInstanceRepo 构造 InstanceRepo。
func NewInstanceRepo(pool *Pool) *InstanceRepo {
	return &InstanceRepo{pool: pool}
}

// Get 读 instance_settings 单行。
func (r *InstanceRepo) Get(ctx context.Context) (domain.InstanceSettings, error) {
	q := dbq.New(r.pool)
	row, err := q.GetInstanceSettings(ctx)
	if err != nil {
		return domain.InstanceSettings{}, fmt.Errorf("get instance settings: %w", err)
	}
	return domain.InstanceSettings{
		IsClaimed:   row.IsClaimed,
		MultiTenant: row.MultiTenant,
		DeployedAt:  row.DeployedAt.Time,
	}, nil
}

// SetSetupTokenHash 把启动时生成的 setup token 的 sha256(hash) 存到
// instance_settings.setup_token_hash。已 claimed 的 instance 不应再调
// 这个（调了也只是 update，没语义意义）。
func (r *InstanceRepo) SetSetupTokenHash(ctx context.Context, hash string) error {
	q := dbq.New(r.pool)
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
// 失败时返回 domain sentinel error；成功时返回新建的 domain.Owner。
func (r *InstanceRepo) ClaimAndCreateOwner(
	ctx context.Context,
	tokenHash string,
	input domain.CreateOwnerInput,
) (domain.Owner, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.Owner{}, fmt.Errorf("begin tx: %w", err)
	}
	// Rollback 在 commit 之后是 no-op；忽略 ErrTxClosed 之外的也无害（事务
	// 结果已经由 commit 决定）。
	//
	//nolint:errcheck // best-effort cleanup; commit 成功后 Rollback 必返 ErrTxClosed
	defer func() { _ = tx.Rollback(ctx) }()

	owner, err := claimTx(ctx, tx, tokenHash, input)
	if err != nil {
		return domain.Owner{}, err
	}

	if cerr := tx.Commit(ctx); cerr != nil {
		return domain.Owner{}, fmt.Errorf("commit claim: %w", cerr)
	}
	return owner, nil
}

// claimTx 是 ClaimAndCreateOwner 的内层。
func claimTx(
	ctx context.Context,
	tx pgx.Tx,
	tokenHash string,
	input domain.CreateOwnerInput,
) (domain.Owner, error) {
	q := dbq.New(tx)

	if _, err := q.TryClaimInstance(ctx, &tokenHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Owner{}, domain.ErrInvalidSetupToken
		}
		return domain.Owner{}, fmt.Errorf("try claim: %w", err)
	}

	row, err := q.CreateOwner(ctx, dbq.CreateOwnerParams{
		Email:        input.Email,
		PasswordHash: input.PasswordHash,
		Handle:       input.Handle,
		FullName:     input.FullName,
	})
	if err != nil {
		return domain.Owner{}, translateCreateOwnerErr(err)
	}
	return toDomainOwner(&row), nil
}

func translateCreateOwnerErr(err error) error {
	constraint, isUnique := pgUniqueViolation(err)
	if !isUnique {
		return fmt.Errorf("create owner: %w", err)
	}
	switch constraint {
	case "owners_email_key":
		return domain.ErrEmailTaken
	case "owners_handle_key":
		return domain.ErrHandleTaken
	default:
		return fmt.Errorf("create owner unique violation %s: %w", constraint, err)
	}
}
