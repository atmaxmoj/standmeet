// owners_pending_email.go —— 待确认的改邮箱：写入 / 确认 / 撤销 / 查。
//
// 三个方法都用 :one + RETURNING，不是 :exec。理由是 [[write-with-no-receipt]]：
// UPDATE 命中 0 行**不报错**，而 :exec 又把行数扔了 —— 于是"已确认"会是一句谎话。
// 这里命中 0 行恰恰是最要紧的那个信号（token 不对 / 已过期 / 已经用过），
// 所以必须让它以 ErrNoRows 的形式浮上来。

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// SetPendingEmail —— 记下待确认的新邮箱 + token hash + 到期时间。
// 第二次调用直接覆盖前一次：两个链接都能用的话，owner 以为改成了后一个，
// 而某个旧标签页一点就把身份送去了前一个。
func (r *Repo) SetPendingEmail(
	ctx context.Context, ownerID, newEmail, tokenHash string, expiresAt time.Time,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	// 规范化在 repo —— 见 email.go。待确认的地址将来要成为 email 那一列，
	// 两边必须用同一把尺子。
	normalized := NormalizeEmail(newEmail)
	row, qerr := db.New(r.pool).SetOwnerPendingEmail(ctx, db.SetOwnerPendingEmailParams{
		ID:                    pgID,
		PendingEmail:          &normalized,
		PendingEmailTokenHash: tokenHash,
		PendingEmailExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if qerr != nil {
		return entity.Owner{}, fmt.Errorf("set pending email: %w", qerr)
	}
	return toDomainOwner(&row), nil
}

// ConfirmPendingEmail —— token 对上且没过期才换身份，换完清空三列（一次性）。
// 命中 0 行 → ErrPendingEmailNotFound，由上层去分辨是过期还是无效。
func (r *Repo) ConfirmPendingEmail(
	ctx context.Context, tokenHash string,
) (entity.Owner, error) {
	row, err := db.New(r.pool).ConfirmOwnerPendingEmail(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrPendingEmailNotFound
		}
		return entity.Owner{}, translateEmailUpdateErr(err)
	}
	return toDomainOwner(&row), nil
}

// PendingEmailChange —— 一次待确认的改动。owner + 到期时间打包，
// 因为函数最多回两样（revive function-result-limit），而这两样本来就属于同一件事。
type PendingEmailChange struct {
	ExpiresAt time.Time
	Owner     entity.Owner
}

// FindByPendingToken —— 只为了分辨「过期」和「压根无效」。两种都不换身份，
// 但对 owner 说的话不一样，而他下一步该做什么取决于这两个词的区别。
func (r *Repo) FindByPendingToken(
	ctx context.Context, tokenHash string,
) (PendingEmailChange, error) {
	row, err := db.New(r.pool).GetOwnerByPendingToken(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return PendingEmailChange{}, entity.ErrPendingEmailNotFound
		}
		return PendingEmailChange{}, fmt.Errorf("find by pending token: %w", err)
	}
	return PendingEmailChange{
		Owner: toDomainOwner(&row), ExpiresAt: row.PendingEmailExpiresAt.Time,
	}, nil
}

// ClearPendingEmail —— owner 反悔。清完那封信里的链接也就死了（token hash 没了）。
func (r *Repo) ClearPendingEmail(ctx context.Context, ownerID string) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	row, err := db.New(r.pool).ClearOwnerPendingEmail(ctx, pgID)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("clear pending email: %w", err)
	}
	return toDomainOwner(&row), nil
}
