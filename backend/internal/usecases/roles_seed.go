// roles_seed.go —— vanilla prompt + vanilla role 种子。owner claim 时调一次
// （也可 server 启动跑一次想幂等的话）。
//
// 设计 [[iam-role-pivot-plan]]。owner 没显式选 role 时 access_code 默认挂
// vanilla role；vanilla 配公开 corpus 三 glob，无 skill，无 mcp，挂 vanilla
// prompt。是删不掉的（repo 层挡 + UI 隐藏 delete）。
//
// 文案匹配设计稿 docs/design/project/admin-data.js PROMPTS[0] + ROLES[0]。

package usecases

import (
	"context"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// SeedVanillaRole —— 对一个 owner 幂等 upsert vanilla prompt + vanilla role
// + role_corpus_uris 三条公开 glob。
func SeedVanillaRole(
	ctx context.Context,
	prompts *postgres.PromptRepo, roles *postgres.RoleRepo,
	ownerID string,
) error {
	promptID, err := upsertVanillaPrompt(ctx, prompts, ownerID)
	if err != nil {
		return err
	}
	role, err := upsertVanillaRole(ctx, roles, ownerID, promptID)
	if err != nil {
		return err
	}
	return syncVanillaRoleJoins(ctx, roles, role.ID())
}

func upsertVanillaPrompt(
	ctx context.Context, prompts *postgres.PromptRepo, ownerID string,
) (string, error) {
	prompt, err := prompts.UpsertBuiltin(ctx, ownerID,
		domain.VanillaPromptName, domain.VanillaPromptDescription, domain.VanillaPromptBody,
	)
	if err != nil {
		return "", fmt.Errorf("upsert vanilla prompt: %w", err)
	}
	return prompt.ID(), nil
}

func upsertVanillaRole(
	ctx context.Context, roles *postgres.RoleRepo, ownerID, promptID string,
) (domain.Role, error) {
	role, err := roles.UpsertBuiltin(ctx, &postgres.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        domain.VanillaRoleName,
		Description: domain.VanillaRoleDescription,
		PromptID:    &promptID,
	})
	if err != nil {
		return domain.Role{}, fmt.Errorf("upsert vanilla role: %w", err)
	}
	return role, nil
}

// syncVanillaRoleJoins —— 同步 role_corpus_uris + 清 skills + 清 mcp。
// vanilla 无 skill / 无 mcp，但显式 clear 让 re-seed 幂等（若以前种过别的
// 后又调回 vanilla 形态，要清干净 join 表）。
func syncVanillaRoleJoins(
	ctx context.Context, roles *postgres.RoleRepo, roleID string,
) error {
	if err := roles.SetCorpusURIs(ctx, roleID, domain.VanillaRoleCorpusURIs); err != nil {
		return fmt.Errorf("set vanilla role corpus uris: %w", err)
	}
	if err := roles.SetSkills(ctx, roleID, []string{}); err != nil {
		return fmt.Errorf("clear vanilla role skills: %w", err)
	}
	if err := roles.SetMCPServers(ctx, roleID, []string{}); err != nil {
		return fmt.Errorf("clear vanilla role mcp servers: %w", err)
	}
	return nil
}
