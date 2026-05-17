// api_token.go —— API token 创建（明文返回一次）+ 撤销 usecase。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// APITokenDeps 把 token CRUD 需要的依赖打包。
type APITokenDeps struct {
	Tokens *postgres.APITokenRepo
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
		return CreatedAPIToken{}, fmt.Errorf("create api token: %w", err)
	}
	return CreatedAPIToken{Token: token, Plaintext: plaintext}, nil
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
	ownerID, err := deps.Tokens.VerifyAndTouch(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, domain.ErrUnauthorized) {
			return "", domain.ErrUnauthorized
		}
		return "", fmt.Errorf("verify api token: %w", err)
	}
	return ownerID, nil
}
