// api_token.go —— API token 创建（明文返回一次）+ 撤销 usecase。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// APITokenDeps 把 token CRUD 需要的依赖打包。
// Owners 仅给 FK 诊断用 —— Create 时如果 FK 报错就查一次 OwnerExists，
// 让日志能区分"ownerID 从 session 来就错了"vs"创建期间被并发删了"。
type APITokenDeps struct {
	Tokens *postgres.APITokenRepo
	Owners *postgres.OwnerRepo
	Log    *slog.Logger
}

// CreatedAPIToken 是 CreateAPIToken 的返回结构（含 plaintext，**只在创建时返回一次**）。
type CreatedAPIToken struct {
	Token     domain.APIToken
	Plaintext string
}

// CreateAPIToken 给 owner 生成新 token：生成 plaintext + hash 入库 + 返回明文。
// 调用者负责把明文展示一次给 owner，之后不再可见。
func CreateAPIToken(
	ctx context.Context, deps APITokenDeps, ownerID, name string,
) (CreatedAPIToken, error) {
	if ownerID == "" || name == "" {
		return CreatedAPIToken{}, ErrEmptyField
	}
	plaintext, err := session.NewAPIToken()
	if err != nil {
		return CreatedAPIToken{}, fmt.Errorf("gen api token: %w", err)
	}
	tokenHash := session.HashAPIToken(plaintext)
	token, err := deps.Tokens.Create(ctx, ownerID, name, tokenHash)
	if err != nil {
		logCreateTokenFailure(ctx, deps, ownerID, err)
		return CreatedAPIToken{}, fmt.Errorf("create api token: %w", err)
	}
	return CreatedAPIToken{Token: token, Plaintext: plaintext}, nil
}

// logCreateTokenFailure —— diagnostic helper. On any Create failure (FK
// violation in particular), check whether the ownerID actually maps to a
// row in owners right now, so the log distinguishes "ownerID from session
// was bad" vs "owner was concurrently wiped between login and tokens".
func logCreateTokenFailure(
	ctx context.Context, deps APITokenDeps, ownerID string, origErr error,
) {
	if deps.Log == nil || deps.Owners == nil {
		return
	}
	exists, qerr := deps.Owners.OwnerExists(ctx, ownerID)
	if qerr != nil {
		deps.Log.Error("create token fk diag: owner-exists query failed",
			"owner_id", ownerID, "scan_err", qerr, "orig", origErr)
		return
	}
	deps.Log.Error("create token fk diag",
		"owner_id", ownerID, "owner_exists", exists, "orig", origErr)
}

// VerifyAPIToken 用明文 token 反查 owner_id；不命中或 hash 错返回 ErrUnauthorized。
// MCP middleware 调它做 bearer auth。
func VerifyAPIToken(
	ctx context.Context, deps APITokenDeps, plaintext string,
) (string, error) {
	if plaintext == "" {
		return "", domain.ErrUnauthorized
	}
	tokenHash := session.HashAPIToken(plaintext)
	ownerID, err := deps.Tokens.VerifyAndTouch(ctx, deps.Log, tokenHash)
	if err != nil {
		if errors.Is(err, domain.ErrUnauthorized) {
			return "", domain.ErrUnauthorized
		}
		return "", fmt.Errorf("verify api token: %w", err)
	}
	return ownerID, nil
}
