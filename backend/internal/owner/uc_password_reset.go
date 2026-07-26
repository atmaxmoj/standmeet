// password_reset.go —— 紧急密码重置的 usecase。
//
// 流程：
//   1. operator 在 server 上跑 `standmeet password-reset` 子命令 → 生成
//      32-byte token，SHA-256 hash 存进 owners.password_reset_hash，
//      password_reset_at = NOW()。stdout 打印 plaintext + URL。
//   2. owner 打开 URL → /account/reset?t=... → 前端读 t + 输入新密码 →
//      POST /api/v1/account/reset-password { token, new_password }。
//   3. 这个 usecase：找 sole owner，TTL 检查 (<= 30min)，SHA-256 const-time
//      比对，过了就 HashPassword(new) + repo.UpdatePasswordHash + clear。
//
// 失败一律返 ErrUnauthorized（不告诉 token 错 vs 过期 vs 用过）。

package owner

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/session"
)

// PasswordResetDeps —— ConsumePasswordResetToken 的依赖。
type PasswordResetDeps struct {
	Owners *Repo
}

// PasswordResetTTL —— token 颁发后多久内有效；CLI stdout 跟前端 / 文档要
// 显示这个值。30min 给 operator 足够时间从 server 切回浏览器；再长就拖
// 攻击者爆破窗口。
const PasswordResetTTL = 30 * time.Minute

// ConsumePasswordResetToken —— 拿明文 token + 新密码：验证 + 改密码 + 清。
// 任何步骤失败统一返 ErrUnauthorized；ErrPasswordTooShort 单独保留
// 给前端 inline hint 区分（密码太短不算 "auth failure"）。
func ConsumePasswordResetToken(
	ctx context.Context, deps PasswordResetDeps, tokenPlaintext, newPassword string,
) error {
	if len(newPassword) < minPasswordLen {
		return ErrPasswordTooShort
	}
	if tokenPlaintext == "" {
		return ErrUnauthorized
	}
	resetToken, err := deps.Owners.GetActiveResetToken(ctx)
	if err != nil {
		return fmt.Errorf("load reset token: %w", err)
	}
	if !matchesAndFresh(tokenPlaintext, resetToken.Hash, resetToken.IssuedAt) {
		return ErrUnauthorized
	}
	return applyNewPassword(ctx, deps, resetToken.OwnerID, newPassword)
}

func matchesAndFresh(plaintext string, hash []byte, issuedAt time.Time) bool {
	if len(hash) == 0 || issuedAt.IsZero() {
		return false
	}
	if time.Since(issuedAt) > PasswordResetTTL {
		return false
	}
	sum := sha256.Sum256([]byte(plaintext))
	return subtle.ConstantTimeCompare(sum[:], hash) == 1
}

func applyNewPassword(
	ctx context.Context, deps PasswordResetDeps, ownerID, newPassword string,
) error {
	newHash, herr := session.HashPassword(newPassword)
	if herr != nil {
		return fmt.Errorf("hash new password: %w", herr)
	}
	if uerr := deps.Owners.UpdatePasswordHash(ctx, ownerID, newHash); uerr != nil {
		return fmt.Errorf("update password_hash: %w", uerr)
	}
	if cerr := deps.Owners.ClearPasswordResetToken(ctx, ownerID); cerr != nil {
		return fmt.Errorf("clear reset token: %w", cerr)
	}
	return nil
}

// ErrNoActiveResetToken —— sole owner 没颁发 reset token；caller 应翻
// ErrUnauthorized。导出让 repo 实现可返。
var ErrNoActiveResetToken = errors.New("no active password reset token")
