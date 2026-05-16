// Package usecases 是 application layer：编排 domain + infra 完成一个个
// 业务流程。usecase 函数本身要 cyclo ≤ 5（cyclop 全局限制），routes 只
// 做最薄派发，业务分支都集中在这里。
package usecases

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// ClaimDeps 把 ClaimInstance 需要的依赖打包，避免参数列表超长。
type ClaimDeps struct {
	Instance *postgres.InstanceRepo
}

// ClaimInput 是 ClaimInstance 的入参。
type ClaimInput struct {
	Token    string
	Email    string
	Password string
	Handle   string
	FullName string
}

// ClaimInstance 跑首次 claim 流程：
//  1. 校验 input 必填字段。
//  2. 把 setup token 明文 hash + password 走 Argon2id。
//  3. 在事务里 atomic claim instance + 创建 owner。
//
// 返回的 Owner 不含 password；password 已经在 input 里被 hash 后写进 DB。
// pointer 接收 *ClaimInput 避免 gocritic hugeParam。
func ClaimInstance(ctx context.Context, deps ClaimDeps, in *ClaimInput) (domain.Owner, error) {
	if err := validateClaimInput(in); err != nil {
		return domain.Owner{}, err
	}

	passwordHash, err := session.HashPassword(in.Password)
	if err != nil {
		return domain.Owner{}, fmt.Errorf("hash password: %w", err)
	}

	tokenHash := session.HashSetupToken(in.Token)

	owner, err := deps.Instance.ClaimAndCreateOwner(ctx, tokenHash, domain.CreateOwnerInput{
		Email:        in.Email,
		PasswordHash: passwordHash,
		Handle:       in.Handle,
		FullName:     in.FullName,
	})
	if err != nil {
		return domain.Owner{}, fmt.Errorf("claim and create owner: %w", err)
	}
	return owner, nil
}

// ErrEmptyField —— 必填字段为空。Handler 翻译成 400。
var ErrEmptyField = errors.New("required field is empty")

// validateClaimInput 用 slice + slices.Contains 让 cyclo = 2。
func validateClaimInput(in *ClaimInput) error {
	fields := []string{in.Token, in.Email, in.Password, in.Handle, in.FullName}
	if slices.Contains(fields, "") {
		return ErrEmptyField
	}
	return nil
}
