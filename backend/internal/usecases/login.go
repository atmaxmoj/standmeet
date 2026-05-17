// login.go —— owner 登录 use case：verify password + 颁发 session。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// LoginDeps 把 Login 需要的依赖打包。
type LoginDeps struct {
	Owners   *postgres.OwnerRepo
	Sessions *session.OwnerSessionStore
}

// LoginInput 是 Login 入参。
type LoginInput struct {
	Email    string
	Password string
}

// LoginOutput 返回 plaintext session token + csrf token，handler 用它写 cookie。
// OwnerHandle 给前端拿到立刻能 redirect /<handle>，省一次 /me 调用。
type LoginOutput struct {
	SessionToken string
	CSRFToken    string
	OwnerID      string
	OwnerHandle  string
}

// Login 校验密码，颁发 session。错密码 / 不存在用户都返回 domain.ErrUnauthorized
// （不区分"用户不存在" vs "密码错"，避免暴露存在性）。
func Login(ctx context.Context, deps LoginDeps, in *LoginInput) (LoginOutput, error) {
	if in.Email == "" || in.Password == "" {
		return LoginOutput{}, ErrEmptyField
	}
	creds, err := authenticate(ctx, deps, in)
	if err != nil {
		return LoginOutput{}, err
	}
	issued, err := deps.Sessions.Issue(ctx, creds.OwnerID)
	if err != nil {
		return LoginOutput{}, fmt.Errorf("issue session: %w", err)
	}
	return LoginOutput{
		SessionToken: issued.Token,
		CSRFToken:    issued.Data.CSRFToken,
		OwnerID:      creds.OwnerID,
		OwnerHandle:  creds.Handle,
	}, nil
}

// authenticate 拆出 Login 中的密码校验部分，让 Login 本身 cognitive-complexity ≤ 7。
func authenticate(
	ctx context.Context, deps LoginDeps, in *LoginInput,
) (postgres.Credentials, error) {
	creds, err := deps.Owners.GetCredentialsByEmail(ctx, in.Email)
	if err != nil {
		if errors.Is(err, domain.ErrOwnerNotFound) {
			return postgres.Credentials{}, domain.ErrUnauthorized
		}
		return postgres.Credentials{}, fmt.Errorf("get credentials: %w", err)
	}
	if verr := session.VerifyPassword(in.Password, creds.PasswordHash); verr != nil {
		if errors.Is(verr, session.ErrPasswordMismatch) {
			return postgres.Credentials{}, domain.ErrUnauthorized
		}
		return postgres.Credentials{}, fmt.Errorf("verify password: %w", verr)
	}
	return creds, nil
}
