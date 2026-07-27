// uc_claim.go —— first-run「claim this instance」编排:建 owner + 密码 + setup-token
// 校验 + 种 public role/prompt。跨 owner/access/marketplace/session,是 owner 域的入驻用例。

package owner

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// ClaimDeps 把 ClaimInstance 需要的依赖打包，避免参数列表超长。
type ClaimDeps struct {
	Instance *InstanceRepo
	Skills   *marketplace.SkillRepo
	Prompts  *PromptRepo
	Roles    *access.RoleRepo
}

// ClaimInput 是 ClaimInstance 的入参。
type ClaimInput struct {
	Token     string
	Email     string
	Password  string
	Handle    string
	FullName  string
	PublicURL string // 完整 URL，含 scheme + host (+ port)。SEO canonical / QR 全用这个。
}

// ClaimInstance 跑首次 claim 流程：
//  1. 校验 input 必填字段。
//  2. 把 setup token 明文 hash + password 走 Argon2id。
//  3. 在事务里 atomic claim instance + 创建 owner。
//
// 返回的 Owner 不含 password；password 已经在 input 里被 hash 后写进 DB。
// pointer 接收 *ClaimInput 避免 gocritic hugeParam。
func ClaimInstance(ctx context.Context, deps ClaimDeps, in *ClaimInput) (Owner, error) {
	if err := validateClaimInput(in); err != nil {
		return Owner{}, err
	}

	passwordHash, err := session.HashPassword(in.Password)
	if err != nil {
		return Owner{}, fmt.Errorf("hash password: %w", err)
	}

	tokenHash := session.HashSetupToken(in.Token)

	created, err := deps.Instance.ClaimAndCreateOwner(ctx, tokenHash, &CreateOwnerInput{
		Email:        in.Email,
		PasswordHash: passwordHash,
		Handle:       in.Handle,
		FullName:     in.FullName,
		PublicURL:    NormalizePublicURL(in.PublicURL),
	})
	if err != nil {
		return Owner{}, fmt.Errorf("claim and create owner: %w", err)
	}
	// FK-violation debugging: log the owner ID created + the email/handle
	// it's bound to. Cross-reference with create-token-fk-diag logs to see
	// if subsequent token creates use the same owner_id.
	slog.Default().Info("claim succeeded",
		"owner_id", created.ID, "email", in.Email, "handle", in.Handle)
	seedClaimSkills(ctx, deps, created.ID)
	seedClaimPublicRole(ctx, deps, created.ID)
	return created, nil
}

// seedClaimSkills —— claim 成功后 seed 内置 skills；失败 log + continue，不
// 阻塞 claim（owner 仍能 login）。
func seedClaimSkills(ctx context.Context, deps ClaimDeps, ownerID string) {
	if deps.Skills == nil {
		return
	}
	if err := marketplace.SeedBuiltinSkills(ctx, deps.Skills, ownerID); err != nil {
		slog.Default().Error("seed builtin skills", "owner_id", ownerID, "err", err)
	}
}

// seedClaimPublicRole —— claim 成功后种 public prompt + public role；失败
// log + continue，不阻塞 claim。详细见 [[iam-role-pivot-plan]]。
func seedClaimPublicRole(ctx context.Context, deps ClaimDeps, ownerID string) {
	if deps.Prompts == nil || deps.Roles == nil {
		return
	}
	if err := SeedPublicRole(ctx, deps.Prompts, deps.Roles, ownerID); err != nil {
		slog.Default().Error("seed public role", "owner_id", ownerID, "err", err)
	}
}

// validateClaimInput 用 slice + slices.Contains 让 cyclo ≤ 2。
func validateClaimInput(in *ClaimInput) error {
	fields := []string{in.Token, in.Email, in.Password, in.Handle, in.FullName, in.PublicURL}
	if slices.Contains(fields, "") {
		return apierr.ErrEmptyField
	}
	if !ValidPublicURL(in.PublicURL) {
		return ErrPublicURLInvalid
	}
	return nil
}

// ValidPublicURL —— 必须 http:// 或 https:// 开头、host 非空。详细 URL 解析
// 在 NormalizePublicURL；这里只挡明显错的（空 scheme / 写了纯 host）。
