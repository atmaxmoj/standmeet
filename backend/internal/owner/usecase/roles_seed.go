// roles_seed.go —— public prompt + public role 种子。owner claim 时调一次
// （也可 server 启动跑一次想幂等的话）。
//
// 设计 [[iam-role-pivot-plan]]。owner 没显式选 role 时 access_code 默认挂
// public role；public 配公开 corpus 三 glob，无 skill，无 mcp，挂 public
// prompt。是删不掉的（repo 层挡 + UI 隐藏 delete）。
//
// 文案匹配设计稿 docs/design/project/admin-data.js PROMPTS[0] + ROLES[0]。

package usecase

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// SeedPublicRole —— 对一个 owner 幂等 upsert public prompt + public role
// + role_corpus_uris 三条公开 glob。
func SeedPublicRole(
	ctx context.Context,
	prompts *repo.PromptRepo, roles *access.RoleRepo,
	ownerID string,
) error {
	promptID, err := upsertPublicPrompt(ctx, prompts, ownerID)
	if err != nil {
		return err
	}
	role, err := upsertPublicRole(ctx, roles, ownerID, promptID)
	if err != nil {
		return err
	}
	if jerr := syncPublicRoleJoins(ctx, roles, role.ID()); jerr != nil {
		return jerr
	}
	if ierr := seedInvitedRole(ctx, roles, ownerID, promptID); ierr != nil {
		return ierr
	}
	// 这里曾经还种过 job loop 要的 `hiring` prompt + role —— 它们不属于这一份。
	// 插件的东西落在装配的地方，只因为 seeder 在那儿（跟 PeriodicWorker 那条注释
	// 记的是同一个教训）。现在归 `internal/owner/jobs/jobs_seed.go`，
	// 经 capabilities.OwnerSeeder 由宿主在同一个时机调。
	return nil
}

// seedInvitedRole —— 产品替 owner 签发的那些码（简历 QR / 批准申请）挂的 builtin role。
//
// 它跟 public 共用同一份 persona（同一个人的声音），区别只在**受邀与否**：这一条带真正的
// 正列表，读得到 owner 策展过的语料；public 只读已发布的。两者分开之前，一次定向邀请
// 拿的是给未受邀者的兜底档 —— 在 public 收窄之后那等于把受邀的人关在门外。
func seedInvitedRole(
	ctx context.Context, roles *access.RoleRepo, ownerID, promptID string,
) error {
	role, err := roles.UpsertBuiltin(ctx, &access.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        access.InvitedRoleName,
		Description: access.InvitedRoleDescription,
		PromptID:    &promptID,
	})
	if err != nil {
		return fmt.Errorf("upsert invited role: %w", err)
	}
	if serr := roles.SetCorpusURIs(ctx, role.ID(), access.InvitedRoleCorpusURIs); serr != nil {
		return fmt.Errorf("set invited role corpus uris: %w", serr)
	}
	return nil
}

func upsertPublicPrompt(
	ctx context.Context, prompts *repo.PromptRepo, ownerID string,
) (string, error) {
	prompt, err := prompts.UpsertBuiltin(
		ctx, ownerID,
		entity.PublicPromptName, entity.PublicPromptDescription, entity.PublicPromptBody,
	)
	if err != nil {
		return "", fmt.Errorf("upsert public prompt: %w", err)
	}
	return prompt.ID(), nil
}

func upsertPublicRole(
	ctx context.Context, roles *access.RoleRepo, ownerID, promptID string,
) (access.Role, error) {
	role, err := roles.UpsertBuiltin(ctx, &access.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        access.PublicRoleName,
		Description: access.PublicRoleDescription,
		PromptID:    &promptID,
	})
	if err != nil {
		return access.Role{}, fmt.Errorf("upsert public role: %w", err)
	}
	return role, nil
}

// syncPublicRoleJoins —— 同步 role_corpus_uris + 清 skills + 清 mcp。
// public 无 skill / 无 mcp，但显式 clear 让 re-seed 幂等（若以前种过别的
// 后又调回 public 形态，要清干净 join 表）。
//
// corpus 那一行现在**清空**：public 读到的是 owner 发布过的那些，由每条笔记自己的
// `published` 定（`CorpusScope.PublishedOnly`）。旧实例升级时这次 re-seed 会把那三条
// `wiki://** output://** writing://**` 删掉 —— 这正是 F-D-7 要的：那份第二清单不该存在。
func syncPublicRoleJoins(
	ctx context.Context, roles *access.RoleRepo, roleID string,
) error {
	if err := roles.SetCorpusURIs(ctx, roleID, access.PublicRoleCorpusURIs); err != nil {
		return fmt.Errorf("set public role corpus uris: %w", err)
	}
	if err := roles.SetSkills(ctx, roleID, []string{}); err != nil {
		return fmt.Errorf("clear public role skills: %w", err)
	}
	if err := roles.SetMCPServers(ctx, roleID, []string{}); err != nil {
		return fmt.Errorf("clear public role mcp servers: %w", err)
	}
	return nil
}
