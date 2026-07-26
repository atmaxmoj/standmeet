// account.go —— owner 自助管理账号字段（full_name / email / password）的
// usecase。email + password 改之前必须验证当前密码——防止 session 被借走后
// 攻击者直接 hijack 账号。
//
// password 校验沿用 session.VerifyPassword（Argon2id constant-time compare）；
// 验证失败统一返 ErrUnauthorized，跟 login 同码，不告诉攻击者哪一步挂。

package owner

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// AccountDeps —— UpdateOwnerFullName / Email / Password 的依赖。
type AccountDeps struct {
	Owners *Repo
}

const (
	minPasswordLen = 12
	maxFullNameLen = 200
	maxEmailLen    = 320 // RFC 5321
)

// ErrPasswordTooShort —— 新密码长度不够；usecase 翻 400，routes 走
// envBadReq 让前端 inline hint。
var ErrPasswordTooShort = errors.New("password must be at least 12 characters")

// UpdateOwnerFullName —— owner 改 full_name。trim + 长度上限 200；空返
// apierr.ErrEmptyField。不需要密码校验（low-stake）。
func UpdateOwnerFullName(
	ctx context.Context, deps AccountDeps, ownerID, raw string,
) (Owner, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Owner{}, apierr.ErrEmptyField
	}
	if len(trimmed) > maxFullNameLen {
		return Owner{}, fmt.Errorf(
			"%w: full_name too long (max %d)", apierr.ErrEmptyField, maxFullNameLen,
		)
	}
	updated, err := deps.Owners.UpdateFullName(ctx, ownerID, trimmed)
	if err != nil {
		return Owner{}, fmt.Errorf("update full_name: %w", err)
	}
	return updated, nil
}

// EmailUpdateInput —— 把 UpdateOwnerEmail 的 ownerID + 双字段打包。
type EmailUpdateInput struct {
	OwnerID         string
	CurrentPassword string
	NewEmail        string
}

// UpdateOwnerEmail —— owner 改 email。先验当前密码，通过才改。新 email 走
// trim + 长度 + 基本格式（@ 含一次）；唯一冲突翻 ErrEmailTaken。
func UpdateOwnerEmail(
	ctx context.Context, deps AccountDeps, in *EmailUpdateInput,
) (Owner, error) {
	if verr := verifyCurrentPassword(ctx, deps, in.OwnerID, in.CurrentPassword); verr != nil {
		return Owner{}, verr
	}
	normalized, nerr := normalizeEmail(in.NewEmail)
	if nerr != nil {
		return Owner{}, nerr
	}
	updated, err := deps.Owners.UpdateEmail(ctx, in.OwnerID, normalized)
	if err != nil {
		return Owner{}, fmt.Errorf("update email: %w", err)
	}
	return updated, nil
}

func normalizeEmail(raw string) (string, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" {
		return "", apierr.ErrEmptyField
	}
	if len(trimmed) > maxEmailLen {
		return "", fmt.Errorf("%w: email too long", apierr.ErrEmptyField)
	}
	if !validEmail(trimmed) {
		return "", fmt.Errorf("%w: email format invalid", apierr.ErrEmptyField)
	}
	return trimmed, nil
}

// validEmail —— 最弱格式校验：含恰好一个 '@' 且左右非空。前端再约束。
func validEmail(s string) bool {
	parts := strings.Split(s, "@")
	if len(parts) != 2 {
		return false
	}
	return parts[0] != "" && parts[1] != "" && strings.Contains(parts[1], ".")
}

// PasswordUpdateInput —— UpdateOwnerPassword 的入参。
type PasswordUpdateInput struct {
	OwnerID         string
	CurrentPassword string
	NewPassword     string
}

// UpdateOwnerPassword —— owner 改密码。先验当前密码 + 新密码长度 ≥
// minPasswordLen，再 HashPassword + repo 写。返 OK 不返 Owner（密码不进
// /me 不影响 sessionStore；连 token 都不刷，老 session 仍然有效）。
func UpdateOwnerPassword(
	ctx context.Context, deps AccountDeps, in *PasswordUpdateInput,
) error {
	if verr := verifyCurrentPassword(ctx, deps, in.OwnerID, in.CurrentPassword); verr != nil {
		return verr
	}
	if len(in.NewPassword) < minPasswordLen {
		return ErrPasswordTooShort
	}
	hash, herr := session.HashPassword(in.NewPassword)
	if herr != nil {
		return fmt.Errorf("hash new password: %w", herr)
	}
	if uerr := deps.Owners.UpdatePasswordHash(ctx, in.OwnerID, hash); uerr != nil {
		return fmt.Errorf("update password_hash: %w", uerr)
	}
	return nil
}

// verifyCurrentPassword —— 拿 ownerID + 明文 password，repo 取 hash，
// session.VerifyPassword constant-time 比对。任何失败都翻成
// ErrUnauthorized——不区分用户存在 / hash 解析失败 / 密码错。
func verifyCurrentPassword(
	ctx context.Context, deps AccountDeps, ownerID, plaintext string,
) error {
	if plaintext == "" {
		return ErrUnauthorized
	}
	hash, err := deps.Owners.GetPasswordHash(ctx, ownerID)
	if err != nil {
		return ErrUnauthorized
	}
	if verr := session.VerifyPassword(plaintext, hash); verr != nil {
		return ErrUnauthorized
	}
	return nil
}
