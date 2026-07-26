// owners_account.go —— owner 自助管理账号字段（full_name / email / password）
// 的 repo 方法。从 owners.go 拆出避免本体超过 350 行 max-lines。
//
// 三个 update 都返完整 Owner row（前端 sessionStore mutate 用），跟
// UpdatePublicURL / UpdateHandle 风格一致。

package owner

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// UpdateFullName —— owner 改自己的 full_name；空字符串 / 全 whitespace 由
// usecase 层拦下，repo 只信纯字符串。
func (r *Repo) UpdateFullName(
	ctx context.Context, ownerID, newFullName string,
) (Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateOwnerFullName(ctx, dbq.UpdateOwnerFullNameParams{
		ID: pgID, FullName: newFullName,
	})
	if qerr != nil {
		return Owner{}, fmt.Errorf("update full_name: %w", qerr)
	}
	return toDomainOwner(&row), nil
}

// UpdateProfileTimezone —— admin booking-policy PATCH 路径触发；空串 = "UTC"。
func (r *Repo) UpdateProfileTimezone(
	ctx context.Context, ownerID, tz string,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	params := dbq.UpdateOwnerProfileTimezoneParams{ID: pgID, ProfileTimezone: tz}
	if _, qerr := q.UpdateOwnerProfileTimezone(ctx, params); qerr != nil {
		return fmt.Errorf("update profile_timezone: %w", qerr)
	}
	return nil
}

// UpdateEmail —— owner 改自己的 email。唯一冲突翻 ErrEmailTaken
// 让 routes 翻 409。usecase 必须先验当前密码。
func (r *Repo) UpdateEmail(
	ctx context.Context, ownerID, newEmail string,
) (Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	row, qerr := q.UpdateOwnerEmail(ctx, dbq.UpdateOwnerEmailParams{
		ID: pgID, Email: newEmail,
	})
	if qerr != nil {
		return Owner{}, translateEmailUpdateErr(qerr)
	}
	return toDomainOwner(&row), nil
}

func translateEmailUpdateErr(err error) error {
	constraint, isUnique := pgstore.UniqueViolation(err)
	if isUnique && constraint == "owners_email_key" {
		return ErrEmailTaken
	}
	return fmt.Errorf("update email: %w", err)
}

// UpdatePasswordHash —— 写 owner password_hash；usecase 必须先验旧密码 +
// 在外面 HashPassword(newPlaintext) 拿到 PHC 字符串。
func (r *Repo) UpdatePasswordHash(
	ctx context.Context, ownerID, newHash string,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	if _, qerr := q.UpdateOwnerPasswordHash(ctx, dbq.UpdateOwnerPasswordHashParams{
		ID: pgID, PasswordHash: newHash,
	}); qerr != nil {
		return fmt.Errorf("update password_hash: %w", qerr)
	}
	return nil
}

// SetRecoveryHash —— #100 写 owner recovery_hash(usecase 在外面 HashPassword(phrase))。
func (r *Repo) SetRecoveryHash(ctx context.Context, ownerID, hash string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	if qerr := dbq.New(r.pool).SetOwnerRecoveryHash(ctx, dbq.SetOwnerRecoveryHashParams{
		ID: pgID, RecoveryHash: hash,
	}); qerr != nil {
		return fmt.Errorf("set recovery_hash: %w", qerr)
	}
	return nil
}

// ClearRecoveryHash —— #100 recover 成功后作废(单次用)。
func (r *Repo) ClearRecoveryHash(ctx context.Context, ownerID string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	if qerr := dbq.New(r.pool).ClearOwnerRecoveryHash(ctx, pgID); qerr != nil {
		return fmt.Errorf("clear recovery_hash: %w", qerr)
	}
	return nil
}

// GetPasswordHash —— 拿 owner 当前 password_hash，给 usecase 验旧密码用。
// 不存在返 ErrOwnerNotFound。
func (r *Repo) GetPasswordHash(ctx context.Context, ownerID string) (string, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return "", fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	hash, err := q.GetOwnerPasswordHash(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return "", ErrOwnerNotFound
		}
		return "", fmt.Errorf("get owner password_hash: %w", err)
	}
	return hash, nil
}

// ActiveResetToken —— sole owner 当前活跃的 password reset 信息。Hash 空
// + IssuedAt zero 表示没活跃 token；usecase 据此判 ErrUnauthorized。
type ActiveResetToken struct {
	IssuedAt time.Time
	OwnerID  string
	Hash     []byte
}

// GetActiveResetToken —— 单 owner self-host：表里第一行 owner 的 reset
// token 信息。表为空返 ErrOwnerNotFound（caller 通常翻 401）。
func (r *Repo) GetActiveResetToken(ctx context.Context) (ActiveResetToken, error) {
	q := dbq.New(r.pool)
	row, err := q.GetFirstOwnerResetToken(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return ActiveResetToken{}, ErrOwnerNotFound
		}
		return ActiveResetToken{}, fmt.Errorf("get reset token row: %w", err)
	}
	out := ActiveResetToken{
		OwnerID: pgstore.FormatUUID(row.ID),
		Hash:    row.PasswordResetHash,
	}
	if row.PasswordResetAt.Valid {
		out.IssuedAt = row.PasswordResetAt.Time
	}
	return out, nil
}

// ClearPasswordResetToken —— reset 成功后清掉 hash + at，让 token 一次性。
func (r *Repo) ClearPasswordResetToken(ctx context.Context, ownerID string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	if cerr := q.ClearPasswordResetToken(ctx, pgID); cerr != nil {
		return fmt.Errorf("clear reset token: %w", cerr)
	}
	return nil
}

// SoleOwnerHandle —— `standmeet password-reset` CLI 用：sole owner 的
// id + public_url（拼 reset URL）。表为空返 ErrOwnerNotFound。
type SoleOwnerHandle struct {
	OwnerID   string
	PublicURL string
}

// GetSoleOwnerHandle —— CLI password-reset 子命令 + 任何只看 "sole owner
// 是谁" 的 helper。GetFirstOwnerResetToken + GetOwnerByID 拼一下。
func (r *Repo) GetSoleOwnerHandle(ctx context.Context) (SoleOwnerHandle, error) {
	q := dbq.New(r.pool)
	tok, err := q.GetFirstOwnerResetToken(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return SoleOwnerHandle{}, ErrOwnerNotFound
		}
		return SoleOwnerHandle{}, fmt.Errorf("get sole owner row: %w", err)
	}
	ownerRow, gerr := q.GetOwnerByID(ctx, tok.ID)
	if gerr != nil {
		return SoleOwnerHandle{}, fmt.Errorf("get owner by id: %w", gerr)
	}
	return SoleOwnerHandle{
		OwnerID:   pgstore.FormatUUID(tok.ID),
		PublicURL: ownerRow.PublicUrl,
	}, nil
}

// SetPasswordResetHash —— CLI 颁发 reset token 时调；写 hash + 当前时间戳。
// 重复调会覆盖旧 token，跟 SQL 语义一致（重新跑命令是合法 UX）。
func (r *Repo) SetPasswordResetHash(
	ctx context.Context, ownerID string, hash []byte,
) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := dbq.New(r.pool)
	if serr := q.SetPasswordResetToken(ctx, dbq.SetPasswordResetTokenParams{
		ID: pgID, PasswordResetHash: hash,
	}); serr != nil {
		return fmt.Errorf("set reset token: %w", serr)
	}
	return nil
}

// GetCSS —— owner 自定义 CSS(sanitize+scope 后的安全版本)。
func (r *Repo) GetCSS(ctx context.Context, ownerID string) (string, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return "", fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	css, err := dbq.New(r.pool).GetOwnerCSS(ctx, pgID)
	if err != nil {
		return "", fmt.Errorf("get owner css: %w", err)
	}
	return css, nil
}

// SetCSS —— 存 owner CSS(caller 应已 sanitize+scope)。
func (r *Repo) SetCSS(ctx context.Context, ownerID, css string) error {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	err := dbq.New(r.pool).SetOwnerCSS(ctx, dbq.SetOwnerCSSParams{ID: pgID, CustomCss: css})
	if err != nil {
		return fmt.Errorf("set owner css: %w", err)
	}
	return nil
}
