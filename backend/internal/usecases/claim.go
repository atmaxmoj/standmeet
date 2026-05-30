// Package usecases 是 application layer：编排 domain + infra 完成一个个
// 业务流程。usecase 函数本身要 cyclo ≤ 5（cyclop 全局限制），routes 只
// 做最薄派发，业务分支都集中在这里。
package usecases

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// ClaimDeps 把 ClaimInstance 需要的依赖打包，避免参数列表超长。
type ClaimDeps struct {
	Instance *postgres.InstanceRepo
	Skills   *postgres.SkillRepo
	Prompts  *postgres.PromptRepo
	Roles    *postgres.RoleRepo
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
func ClaimInstance(ctx context.Context, deps ClaimDeps, in *ClaimInput) (domain.Owner, error) {
	if err := validateClaimInput(in); err != nil {
		return domain.Owner{}, err
	}

	passwordHash, err := session.HashPassword(in.Password)
	if err != nil {
		return domain.Owner{}, fmt.Errorf("hash password: %w", err)
	}

	tokenHash := session.HashSetupToken(in.Token)

	owner, err := deps.Instance.ClaimAndCreateOwner(ctx, tokenHash, &domain.CreateOwnerInput{
		Email:        in.Email,
		PasswordHash: passwordHash,
		Handle:       in.Handle,
		FullName:     in.FullName,
		PublicURL:    normalizePublicURL(in.PublicURL),
	})
	if err != nil {
		return domain.Owner{}, fmt.Errorf("claim and create owner: %w", err)
	}
	// FK-violation debugging: log the owner ID created + the email/handle
	// it's bound to. Cross-reference with create-token-fk-diag logs to see
	// if subsequent token creates use the same owner_id.
	slog.Default().Info("claim succeeded",
		"owner_id", owner.ID, "email", in.Email, "handle", in.Handle)
	seedClaimSkills(ctx, deps, owner.ID)
	seedClaimVanillaRole(ctx, deps, owner.ID)
	return owner, nil
}

// seedClaimSkills —— claim 成功后 seed 内置 skills；失败 log + continue，不
// 阻塞 claim（owner 仍能 login）。
func seedClaimSkills(ctx context.Context, deps ClaimDeps, ownerID string) {
	if deps.Skills == nil {
		return
	}
	if err := SeedBuiltinSkills(ctx, deps.Skills, ownerID); err != nil {
		slog.Default().Error("seed builtin skills", "owner_id", ownerID, "err", err)
	}
}

// seedClaimVanillaRole —— claim 成功后种 vanilla prompt + vanilla role；失败
// log + continue，不阻塞 claim。详细见 [[iam-role-pivot-plan]]。
func seedClaimVanillaRole(ctx context.Context, deps ClaimDeps, ownerID string) {
	if deps.Prompts == nil || deps.Roles == nil {
		return
	}
	if err := SeedVanillaRole(ctx, deps.Prompts, deps.Roles, ownerID); err != nil {
		slog.Default().Error("seed vanilla role", "owner_id", ownerID, "err", err)
	}
}

// ErrEmptyField —— 必填字段为空。Handler 翻译成 400。
var ErrEmptyField = errors.New("required field is empty")

// validateClaimInput 用 slice + slices.Contains 让 cyclo ≤ 2。
func validateClaimInput(in *ClaimInput) error {
	fields := []string{in.Token, in.Email, in.Password, in.Handle, in.FullName, in.PublicURL}
	if slices.Contains(fields, "") {
		return ErrEmptyField
	}
	if !validPublicURL(in.PublicURL) {
		return ErrPublicURLInvalid
	}
	return nil
}

// ErrPublicURLInvalid —— public_url 不是 http(s):// 开头的 URL。
var ErrPublicURLInvalid = errors.New("public_url must be a full URL with scheme")

const (
	httpPrefix  = "http://"
	httpsPrefix = "https://"
)

// validPublicURL —— 必须 http:// 或 https:// 开头、host 非空。详细 URL 解析
// 在 normalizePublicURL；这里只挡明显错的（空 scheme / 写了纯 host）。
func validPublicURL(s string) bool {
	return len(s) > len(httpsPrefix) &&
		(strings.HasPrefix(s, httpPrefix) || strings.HasPrefix(s, httpsPrefix))
}

// normalizePublicURL —— 去末尾斜杠。dev "http://localhost:38127/" 跟
// "http://localhost:38127" 写进 DB 后保持一致；QR builder 直接拼 "/?code=" 即可。
func normalizePublicURL(s string) string {
	for s != "" && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}
