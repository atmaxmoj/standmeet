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
	return syncPublicRoleJoins(ctx, roles, role.ID())
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
